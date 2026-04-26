#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const FOCUS_METRICS = [
  'loadAppointmentMs',
  'loadCurrentAppointmentForValidationMs',
  'validationMs',
  'loadStaffBundleMs',
  'staffConstraintValidationMs',
  'serviceRulesValidationMs',
  'availabilityValidationMs',
  'workingHoursValidationMs',
  'breaksValidationMs',
  'timeOffValidationMs',
  'holidayValidationMs',
  'loadTargetSlotMs',
  'overlapCheckMs',
  'transactionMs',
  'txCallbackMs',
  'applyRescheduleUpdateMs',
  'timeSlotsRescheduleMs',
  'timeSlotsUpdateMs',
  'postRescheduleInvalidationMs',
  'commitMs',
  'totalRescheduleMs',
  'totalMs',
];

const VALIDATION_VERDICT_METRICS = [
  'loadStaffBundleMs',
  'staffConstraintValidationMs',
  'serviceRulesValidationMs',
  'workingHoursValidationMs',
  'breaksValidationMs',
  'timeOffValidationMs',
  'holidayValidationMs',
  'availabilityValidationMs',
  'validationMs',
];

const IMPORTANT_OUTLIER_METRICS = [
  'loadAppointmentMs',
  'loadCurrentAppointmentForValidationMs',
  'validationMs',
  'loadStaffBundleMs',
  'staffConstraintValidationMs',
  'serviceRulesValidationMs',
  'availabilityValidationMs',
  'workingHoursValidationMs',
  'breaksValidationMs',
  'timeOffValidationMs',
  'holidayValidationMs',
  'loadTargetSlotMs',
  'overlapCheckMs',
  'transactionMs',
  'txCallbackMs',
  'applyRescheduleUpdateMs',
  'timeSlotsRescheduleMs',
  'timeSlotsUpdateMs',
  'postRescheduleInvalidationMs',
  'commitMs',
];

function usage() {
  console.error(
    [
      'Usage:',
      '  node scripts/summarize-reschedule-perf.cjs <log-file>',
      '',
      'Example:',
      '  node scripts/summarize-reschedule-perf.cjs reschedule-3000.out.log',
    ].join('\n'),
  );
}

function round(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarizeNumbers(values) {
  if (!values.length) {
    return {
      count: 0,
      avg: null,
      p90: null,
      p95: null,
      max: null,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    avg: total / values.length,
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    max: Math.max(...values),
  };
}

function formatMs(value) {
  return value == null ? 'n/a' : `${round(value)} ms`;
}

function formatCount(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function safeParseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }

  const jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    return null;
  }
}

function isNumericMetric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function getStatusBucket(statusCode) {
  if (statusCode === 200 || statusCode === 409) return statusCode;
  return null;
}

function getTotalMetric(entry) {
  if (isNumericMetric(entry.totalRescheduleMs)) return entry.totalRescheduleMs;
  if (isNumericMetric(entry.totalMs)) return entry.totalMs;
  return null;
}

function collectMetrics(entry) {
  const metrics = {};
  for (const metric of FOCUS_METRICS) {
    if (isNumericMetric(entry[metric])) {
      metrics[metric] = entry[metric];
    }
  }
  return metrics;
}

function createStatusAccumulator(statusCode) {
  return {
    statusCode,
    entries: [],
    totals: [],
    dominantCounts: {},
    metricValues: {},
    skippedNoTotal: 0,
  };
}

function ensureMetricBucket(store, metric) {
  if (!store[metric]) {
    store[metric] = [];
  }
  return store[metric];
}

function addEntryToAccumulator(acc, entry) {
  const total = getTotalMetric(entry);
  if (!isNumericMetric(total)) {
    acc.skippedNoTotal += 1;
    return;
  }

  const metrics = collectMetrics(entry);
  const normalized = {
    raw: entry,
    statusCode: entry.statusCode,
    appointmentId: entry.appointmentId || null,
    staffId: entry.staffId || null,
    startTime: entry.startTime || entry.slotTime || null,
    targetDate: entry.targetDate || entry.date || null,
    total,
    dominantStep:
      typeof entry.dominantStep === 'string' && entry.dominantStep.trim()
        ? entry.dominantStep
        : null,
    dominantStepMs: isNumericMetric(entry.dominantStepMs)
      ? entry.dominantStepMs
      : null,
    metrics,
  };

  acc.entries.push(normalized);
  acc.totals.push(total);

  if (normalized.dominantStep) {
    acc.dominantCounts[normalized.dominantStep] =
      (acc.dominantCounts[normalized.dominantStep] || 0) + 1;
  }

  for (const [metric, value] of Object.entries(metrics)) {
    ensureMetricBucket(acc.metricValues, metric).push(value);
  }
}

function printStatusSummary(acc) {
  const totals = summarizeNumbers(acc.totals);
  console.log(`Status ${acc.statusCode}`);
  console.log(`  count: ${formatCount(totals.count)}`);
  console.log(`  avg total: ${formatMs(totals.avg)}`);
  console.log(`  p90 total: ${formatMs(totals.p90)}`);
  console.log(`  p95 total: ${formatMs(totals.p95)}`);
  console.log(`  max total: ${formatMs(totals.max)}`);
  if (acc.skippedNoTotal > 0) {
    console.log(`  skipped entries without total: ${acc.skippedNoTotal}`);
  }
}

function getMetricNamesForStatus(acc) {
  const present = new Set(Object.keys(acc.metricValues));
  const ordered = [];

  for (const metric of FOCUS_METRICS) {
    if (present.has(metric)) {
      ordered.push(metric);
      present.delete(metric);
    }
  }

  for (const metric of [...present].sort()) {
    ordered.push(metric);
  }

  return ordered;
}

function printMetricSummary(acc) {
  console.log(`Status ${acc.statusCode}`);
  const metricNames = getMetricNamesForStatus(acc);

  if (!metricNames.length) {
    console.log('  No numeric metrics found.');
    return;
  }

  for (const metric of metricNames) {
    const values = acc.metricValues[metric] || [];
    const summary = summarizeNumbers(values);
    const dominantCount = acc.dominantCounts[metric] || 0;
    console.log(
      `  ${metric}: avg=${formatMs(summary.avg)} | p90=${formatMs(summary.p90)} | p95=${formatMs(summary.p95)} | max=${formatMs(summary.max)} | dominantStepCount=${dominantCount}`,
    );
  }
}

function getImportantMetricPairs(entry) {
  const pairs = [];
  for (const metric of IMPORTANT_OUTLIER_METRICS) {
    const value = entry.metrics[metric];
    if (isNumericMetric(value) && value > 0) {
      pairs.push([metric, value]);
    }
  }
  return pairs.sort((a, b) => b[1] - a[1]);
}

function printOutliers(acc) {
  const top = [...acc.entries].sort((a, b) => b.total - a.total).slice(0, 5);
  console.log(`Status ${acc.statusCode}`);

  if (!top.length) {
    console.log('  No entries.');
    return;
  }

  top.forEach((entry, index) => {
    const importantPairs = getImportantMetricPairs(entry).slice(0, 8);
    const context = [];
    if (entry.appointmentId) context.push(`appointmentId=${entry.appointmentId}`);
    if (entry.staffId) context.push(`staffId=${entry.staffId}`);
    if (entry.startTime) context.push(`startTime=${entry.startTime}`);
    if (entry.targetDate) context.push(`targetDate=${entry.targetDate}`);

    console.log(`  ${index + 1}. total=${formatMs(entry.total)} | dominantStep=${entry.dominantStep || 'n/a'} | ${context.join(' | ')}`);
    if (importantPairs.length) {
      console.log(
        `     metrics: ${importantPairs
          .map(([metric, value]) => `${metric}=${round(value)}`)
          .join(', ')}`,
      );
    }
  });
}

function decideValidationLeader(acc) {
  const candidates = [];
  for (const metric of VALIDATION_VERDICT_METRICS) {
    const values = acc.metricValues[metric] || [];
    if (!values.length) continue;

    const summary = summarizeNumbers(values);
    const dominantCount = acc.dominantCounts[metric] || 0;
    candidates.push({
      metric,
      avg: summary.avg,
      p95: summary.p95,
      dominantCount,
      count: values.length,
    });
  }

  if (!candidates.length) return null;

  const specificCandidates = candidates.filter(
    (candidate) =>
      candidate.metric !== 'validationMs' &&
      candidate.metric !== 'availabilityValidationMs',
  );
  const effectiveCandidates = specificCandidates.length
    ? specificCandidates
    : candidates;

  effectiveCandidates.sort((a, b) => {
    if (b.dominantCount !== a.dominantCount) return b.dominantCount - a.dominantCount;
    if ((b.p95 || 0) !== (a.p95 || 0)) return (b.p95 || 0) - (a.p95 || 0);
    return (b.avg || 0) - (a.avg || 0);
  });

  return effectiveCandidates[0];
}

function classifyBottleneck(metricName) {
  if (!metricName) return 'insufficient data';
  if (
    metricName === 'loadStaffBundleMs' ||
    metricName === 'loadAppointmentMs' ||
    metricName === 'loadCurrentAppointmentForValidationMs' ||
    metricName === 'loadTargetSlotMs'
  ) {
    return 'query/load-bound';
  }
  if (
    metricName === 'validationMs' ||
    metricName === 'availabilityValidationMs'
  ) {
    return 'mixed validation-bound';
  }
  return 'rules-bound';
}

function printVerdict(acc200, acc409) {
  const leader409 = decideValidationLeader(acc409);
  const leader200 = decideValidationLeader(acc200);

  console.log('Status 409');
  if (!leader409) {
    console.log('  No validation sub-metrics found. Insufficient data.');
  } else {
    console.log(
      `  Most likely dominant validation metric: ${leader409.metric} (avg=${formatMs(leader409.avg)}, p95=${formatMs(leader409.p95)}, dominantStepCount=${leader409.dominantCount})`,
    );
    console.log(`  Likely bottleneck type: ${classifyBottleneck(leader409.metric)}`);
  }

  console.log('Status 200');
  if (!leader200) {
    console.log('  No validation sub-metrics found. Insufficient data.');
  } else {
    console.log(
      `  Most likely dominant validation metric: ${leader200.metric} (avg=${formatMs(leader200.avg)}, p95=${formatMs(leader200.p95)}, dominantStepCount=${leader200.dominantCount})`,
    );
    console.log(`  Likely bottleneck type: ${classifyBottleneck(leader200.metric)}`);
  }

  if (!leader409 && !leader200) {
    console.log('Overall');
    console.log('  Validation bottleneck verdict is unavailable because no validation-focused metrics were present in the parsed log lines.');
  }
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    usage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Log file not found: ${resolvedPath}`);
    process.exit(1);
  }

  const accumulators = {
    200: createStatusAccumulator(200),
    409: createStatusAccumulator(409),
  };

  let totalLines = 0;
  let parsedJsonLines = 0;
  let matchedPerfLines = 0;
  let skippedMalformed = 0;
  let skippedOtherStatuses = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(resolvedPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    totalLines += 1;
    const parsed = safeParseLine(line);
    if (!parsed) {
      skippedMalformed += 1;
      continue;
    }

    parsedJsonLines += 1;

    if (
      parsed.type !== 'RESCHEDULE_PERF' &&
      parsed.type !== 'RESCHEDULE_PHASE_BREAKDOWN'
    ) {
      continue;
    }

    const bucket = getStatusBucket(parsed.statusCode);
    if (!bucket) {
      skippedOtherStatuses += 1;
      continue;
    }

    matchedPerfLines += 1;
    addEntryToAccumulator(accumulators[bucket], parsed);
  }

  console.log('Reschedule performance log summary');
  console.log(`file: ${resolvedPath}`);
  console.log(`total lines: ${totalLines}`);
  console.log(`json-like lines parsed: ${parsedJsonLines}`);
  console.log(`matched reschedule perf lines: ${matchedPerfLines}`);
  console.log(`skipped malformed/non-json lines: ${skippedMalformed}`);
  console.log(`skipped other statuses: ${skippedOtherStatuses}`);
  console.log('');

  console.log('Summary by status');
  printStatusSummary(accumulators[409]);
  printStatusSummary(accumulators[200]);
  console.log('');

  console.log('Summary by metric');
  printMetricSummary(accumulators[409]);
  printMetricSummary(accumulators[200]);
  console.log('');

  console.log('Top outliers');
  printOutliers(accumulators[409]);
  printOutliers(accumulators[200]);
  console.log('');

  console.log('Validation bottleneck verdict');
  printVerdict(accumulators[200], accumulators[409]);
}

main().catch((error) => {
  console.error('Failed to summarize reschedule performance logs.');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
