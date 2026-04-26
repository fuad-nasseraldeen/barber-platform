#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const args = {
    appointmentId: null,
    iterations: 40,
    warmup: 5,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--appointment-id' || token === '--id') {
      args.appointmentId = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === '--iterations' || token === '-n') {
      args.iterations = Number(argv[i + 1] || args.iterations);
      i += 1;
      continue;
    }
    if (token === '--warmup') {
      args.warmup = Number(argv[i + 1] || args.warmup);
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.iterations) || args.iterations <= 0) {
    args.iterations = 40;
  }
  if (!Number.isFinite(args.warmup) || args.warmup < 0) {
    args.warmup = 5;
  }

  return args;
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(values) {
  if (!values.length) {
    return { count: 0, avg: null, p90: null, p95: null, min: null, max: null };
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    avg: sum / values.length,
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function formatMs(value) {
  return value == null ? 'n/a' : `${round(value)} ms`;
}

async function main() {
  loadDotEnv(path.resolve(__dirname, '..', '.env'));

  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const appointmentId =
      args.appointmentId ||
      (
        await prisma.appointment.findFirst({
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
          },
        })
      )?.id;

    if (!appointmentId) {
      throw new Error('No appointment found to benchmark. Pass --appointment-id <id>.');
    }

    const queries = [
      {
        name: 'minimalByIdQuery',
        run: () =>
          prisma.appointment.findUnique({
            where: { id: appointmentId },
            select: {
              id: true,
            },
          }),
      },
      {
        name: 'currentRescheduleLoadQuery',
        run: () =>
          prisma.appointment.findUnique({
            where: { id: appointmentId },
            select: {
              id: true,
              businessId: true,
              staffId: true,
              serviceId: true,
              startTime: true,
              endTime: true,
              status: true,
              service: {
                select: {
                  durationMinutes: true,
                  bufferBeforeMinutes: true,
                  bufferAfterMinutes: true,
                },
              },
            },
          }),
      },
    ];

    console.log('Appointment load benchmark');
    console.log(`appointmentId: ${appointmentId}`);
    console.log(`iterations: ${args.iterations}`);
    console.log(`warmup: ${args.warmup}`);
    console.log('');

    for (const query of queries) {
      for (let i = 0; i < args.warmup; i += 1) {
        await query.run();
      }

      const samples = [];
      for (let i = 0; i < args.iterations; i += 1) {
        const t0 = nowMs();
        await query.run();
        samples.push(nowMs() - t0);
      }

      const stats = summarize(samples);
      console.log(query.name);
      console.log(`  count: ${stats.count}`);
      console.log(`  avg: ${formatMs(stats.avg)}`);
      console.log(`  p90: ${formatMs(stats.p90)}`);
      console.log(`  p95: ${formatMs(stats.p95)}`);
      console.log(`  min: ${formatMs(stats.min)}`);
      console.log(`  max: ${formatMs(stats.max)}`);
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Appointment load benchmark failed.');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
