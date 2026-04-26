/**
 * One-shot: k6 load-test, then post-k6 DB correctness checks.
 *
 * From barber-platform/backend (with AUTH_TOKEN, BUSINESS_ID, etc. in the shell):
 *   npm run k6:verify
 *
 * Loads backend/.env (+ .env.local) so DATABASE_URL is available without exporting it in the shell.
 * If DATABASE_URL is set and STAFF_IDS / SERVICE_IDS / CUSTOMER_IDS are missing,
 * fixture UUIDs are loaded from PostgreSQL for BUSINESS_ID (see scripts/k6-resolve-fixture-from-db.ts).
 *
 * Optional scope for DB checks only:
 *   npm run k6:verify -- --businessId=<uuid>
 *
 * Stricter latency thresholds (same as k6 alone):
 *   STRICT_LOAD_TEST=1 npm run k6:verify
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.join(__dirname, '..');

/** Same as ts-node scripts: load backend/.env so DATABASE_URL exists for fixture resolver. */
function loadBackendEnvFiles() {
  const envPath = path.join(backendRoot, '.env');
  const localPath = path.join(backendRoot, '.env.local');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
  if (fs.existsSync(localPath)) {
    dotenv.config({ path: localPath, override: true });
  }
}

loadBackendEnvFiles();

const extraArgs = process.argv.slice(2);

function businessIdCliFlag(argv) {
  for (const a of argv) {
    if (a.startsWith('--businessId=')) {
      const v = a.slice('--businessId='.length).trim();
      return v ? `--businessId=${v}` : undefined;
    }
  }
  const idx = argv.indexOf('--businessId');
  if (idx >= 0 && argv[idx + 1]) {
    const v = argv[idx + 1].trim();
    return v ? `--businessId=${v}` : undefined;
  }
  return undefined;
}

const businessArg = businessIdCliFlag(extraArgs);

function applyBusinessIdFromArgv(argv) {
  for (const a of argv) {
    if (a.startsWith('--businessId=')) {
      const v = a.slice('--businessId='.length).trim();
      if (v) process.env.BUSINESS_ID = v;
      return;
    }
  }
  const idx = argv.indexOf('--businessId');
  if (idx >= 0 && argv[idx + 1]) {
    const v = argv[idx + 1].trim();
    if (v) process.env.BUSINESS_ID = v;
  }
}

function envListNonEmpty(name) {
  const v = (process.env[name] || '').trim();
  if (!v) return false;
  return v.split(',').some((s) => s.trim().length > 0);
}

/**
 * Merge STAFF_IDS, SERVICE_IDS, CUSTOMER_IDS, K6_SERVICE_DURATIONS from DB when incomplete.
 * Exits the process on resolver failure (e.g. unknown businessId).
 */
function mergeK6FixtureFromDbIfNeeded() {
  const businessId = (
    process.env.BUSINESS_ID ||
    process.env.TEST_BUSINESS_ID ||
    ''
  ).trim();
  if (!businessId) return;

  const hasStaff = envListNonEmpty('STAFF_IDS');
  const hasSvc = envListNonEmpty('SERVICE_IDS');
  const hasCust = envListNonEmpty('CUSTOMER_IDS');
  if (hasStaff && hasSvc && hasCust) return;

  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (!dbUrl) {
    console.warn(
      '\n# k6: STAFF_IDS / SERVICE_IDS / CUSTOMER_IDS incomplete and DATABASE_URL is unset — cannot load fixture from DB.\n' +
        '# Set DATABASE_URL (backend/.env) or export IDs from: node k6/setup-token.js\n',
    );
    return;
  }

  const tsNode = path.join(
    backendRoot,
    'node_modules',
    'ts-node',
    'dist',
    'bin.js',
  );
  const script = path.join(backendRoot, 'scripts', 'k6-resolve-fixture-from-db.ts');
  const r = spawnSync(process.execPath, [tsNode, script], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: { ...process.env, BUSINESS_ID: businessId },
  });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if ((r.status ?? 1) !== 0) {
    console.error(
      r.stderr || r.stdout || 'k6-resolve-fixture-from-db exited non-zero',
    );
    process.exit(r.status ?? 1);
  }
  const lines = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  let data;
  try {
    data = JSON.parse(lines[lines.length - 1]);
  } catch {
    console.error(
      'k6:resolve-fixture: expected JSON line on stdout, got:',
      (r.stdout || '').slice(-400),
    );
    process.exit(1);
  }
  if (!hasStaff && data.staffIds?.length) {
    process.env.STAFF_IDS = data.staffIds.join(',');
  }
  if (!hasSvc && data.serviceIds?.length) {
    process.env.SERVICE_IDS = data.serviceIds.join(',');
  }
  if (!hasCust && data.customerIds?.length) {
    process.env.CUSTOMER_IDS = data.customerIds.join(',');
  }
  const dur = (data.k6ServiceDurations || '').trim();
  if (dur && !(process.env.K6_SERVICE_DURATIONS || '').trim()) {
    process.env.K6_SERVICE_DURATIONS = dur;
  }
  console.log(
    `\n# k6: loaded fixture from DB for businessId=${businessId.slice(0, 8)}… (STAFF_IDS/SERVICE_IDS/CUSTOMER_IDS as needed)\n`,
  );
}

applyBusinessIdFromArgv(extraArgs);
mergeK6FixtureFromDbIfNeeded();

function runK6() {
  console.log('=== 1/2 k6 load-test (k6/load-test.js) ===\n');
  const r = spawnSync('k6', ['run', 'k6/load-test.js'], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (r.error) {
    console.error(r.error.message);
    console.error(
      'Hint: install k6 and ensure it is on PATH (https://k6.io/docs/get-started/installation/).',
    );
    return 1;
  }
  return r.status ?? 1;
}

function runPostChecks() {
  console.log('\n=== 2/2 post-k6 DB checks (npm run post-k6-checks) ===\n');
  const npmArgs = ['run', 'post-k6-checks'];
  if (businessArg) {
    npmArgs.push('--', businessArg);
  }
  const r = spawnSync('npm', npmArgs, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (r.error) {
    console.error(r.error.message);
    return 1;
  }
  return r.status ?? 1;
}

const k6Code = runK6();
if (k6Code !== 0) {
  console.warn(
    '\n(k6 exited non-zero — still running DB checks to inspect state after the run.)\n',
  );
}
const checksCode = runPostChecks();
const finalCode = k6Code !== 0 || checksCode !== 0 ? 1 : 0;
if (finalCode !== 0) {
  console.error(
    '\n=== k6:verify finished with failures (k6 and/or post-k6-checks) ===',
  );
} else {
  console.log('\n=== k6:verify finished OK (k6 + post-k6-checks) ===');
}
process.exit(finalCode);
