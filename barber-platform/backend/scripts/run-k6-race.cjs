/**
 * Booking concurrency race (k6/booking-race-concurrency.test.js).
 *
 * Loads backend/.env (+ .env.local). Requires BUSINESS_ID, AUTH_TOKEN.
 * Optional: pass through extra k6 flags after -- e.g. npm run k6:race -- --quiet
 *
 *   npm run k6:race
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.join(__dirname, '..');

function loadBackendEnvFiles() {
  const envPath = path.join(backendRoot, '.env');
  const localPath = path.join(backendRoot, '.env.local');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
}

function stripQuotes(s) {
  const t = String(s || '').trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function normalizeAuthToken() {
  const raw = process.env.AUTH_TOKEN || process.env.K6_AUTH_TOKEN || '';
  const t = String(raw).trim().replace(/^Bearer\s+/i, '');
  if (t) {
    process.env.AUTH_TOKEN = t;
    process.env.K6_AUTH_TOKEN = t;
  }
}

function normalizeBusinessId() {
  const id = stripQuotes(process.env.BUSINESS_ID || process.env.TEST_BUSINESS_ID || '');
  if (id) {
    process.env.BUSINESS_ID = id;
    process.env.TEST_BUSINESS_ID = id;
  }
}

const extraArgs = process.argv.slice(2);

function applyBusinessIdFromArgv(argv) {
  for (const a of argv) {
    if (a.startsWith('--businessId=')) {
      process.env.BUSINESS_ID = stripQuotes(a.slice('--businessId='.length));
      return true;
    }
  }
  const idx = argv.indexOf('--businessId');
  if (idx >= 0 && argv[idx + 1]) {
    process.env.BUSINESS_ID = stripQuotes(argv[idx + 1]);
    return true;
  }
  return false;
}

loadBackendEnvFiles();
applyBusinessIdFromArgv(extraArgs);
normalizeBusinessId();
normalizeAuthToken();

const bid = (process.env.BUSINESS_ID || '').trim();
const tok = (process.env.AUTH_TOKEN || '').trim();
if (!bid) {
  console.error('Missing BUSINESS_ID (backend/.env or --businessId=).');
  process.exit(1);
}
if (!tok) {
  console.error('Missing AUTH_TOKEN / K6_AUTH_TOKEN.');
  process.exit(1);
}

const k6Script = 'k6/booking-race-concurrency.test.js';
const forward = extraArgs.filter(
  (a) => !a.startsWith('--businessId=') && a !== '--businessId',
);
const filtered = [];
for (let i = 0; i < forward.length; i++) {
  if (forward[i] === '--businessId') {
    i++;
    continue;
  }
  filtered.push(forward[i]);
}

console.log(`k6:race → ${k6Script} VUs=${process.env.K6_RACE_VUS || '8'} businessId=${bid.slice(0, 8)}…\n`);

/** k6:correctness uses K6_CORRECTNESS_DATE (often seed anchor / yesterday). Race must scan forward days for USE_TIME_SLOTS seed window — do not inherit that var. */
const k6Env = { ...process.env };
if (!String(k6Env.K6_RACE_DATE || '').trim()) {
  delete k6Env.K6_CORRECTNESS_DATE;
}

const r = spawnSync('k6', ['run', k6Script, ...filtered], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: k6Env,
  shell: process.platform === 'win32',
});

if (r.error) {
  console.error(r.error.message);
  console.error('Install k6: https://k6.io/docs/get-started/installation/');
  process.exit(1);
}
process.exit(r.status ?? 0);
