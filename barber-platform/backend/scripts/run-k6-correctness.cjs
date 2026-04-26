/**
 * Run k6 booking correctness suite (single script: k6/booking-correctness.test.js).
 *
 * backend/.env (or .env.local):
 *   BUSINESS_ID=<uuid>
 *   AUTH_TOKEN=<JWT access token>   (optional prefix "Bearer "; stripped for k6)
 *
 * Fixtures are resolved inside k6 via GET /staff, /services, /customers (no DATABASE_URL required).
 *
 *   npm run k6:correctness
 *   npm run k6:correctness -- --businessId=<uuid>
 *
 * Optional:
 *   K6_CORRECTNESS_DATE=YYYY-MM-DD
 *   K6_SEED_ANCHOR_YMD / K6_FALLBACK_DATES (see k6/booking-correctness.test.js header)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.join(__dirname, '..');

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
  const raw =
    process.env.AUTH_TOKEN ||
    process.env.K6_AUTH_TOKEN ||
    '';
  const t = String(raw)
    .trim()
    .replace(/^Bearer\s+/i, '');
  if (t) {
    process.env.AUTH_TOKEN = t;
    process.env.K6_AUTH_TOKEN = t;
  }
}

function normalizeBusinessId() {
  const id = stripQuotes(
    process.env.BUSINESS_ID || process.env.TEST_BUSINESS_ID || '',
  );
  if (id) {
    process.env.BUSINESS_ID = id;
    process.env.TEST_BUSINESS_ID = id;
  }
}

const extraArgs = process.argv.slice(2);

function applyBusinessIdFromArgv(argv) {
  for (const a of argv) {
    if (a.startsWith('--businessId=')) {
      const v = stripQuotes(a.slice('--businessId='.length));
      if (v) process.env.BUSINESS_ID = v;
      return;
    }
  }
  const idx = argv.indexOf('--businessId');
  if (idx >= 0 && argv[idx + 1]) {
    const v = stripQuotes(argv[idx + 1]);
    if (v) process.env.BUSINESS_ID = v;
  }
}

loadBackendEnvFiles();
applyBusinessIdFromArgv(extraArgs);
normalizeBusinessId();
normalizeAuthToken();

const bid = (process.env.BUSINESS_ID || '').trim();
const tok = (process.env.AUTH_TOKEN || '').trim();

if (!bid) {
  console.error(
    'Missing BUSINESS_ID. Add to backend/.env or pass --businessId=<uuid>',
  );
  process.exit(1);
}
if (!tok) {
  console.error('Missing AUTH_TOKEN (or K6_AUTH_TOKEN).');
  process.exit(1);
}

let k6Script = 'k6/booking-correctness.test.js';
for (const a of extraArgs) {
  if (a.startsWith('--k6-script=')) {
    k6Script = a.slice('--k6-script='.length).trim();
  }
}

console.log(
  `k6:correctness → ${k6Script} businessId=${bid.slice(0, 8)}… tokenLen=${tok.length}\n`,
);

const r = spawnSync('k6', ['run', k6Script], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

if (r.error) {
  console.error(r.error.message);
  console.error('Install k6: https://k6.io/docs/get-started/installation/');
  process.exit(1);
}
process.exit(r.status ?? 0);
