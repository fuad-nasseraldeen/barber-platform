/**
 * Run k6 booking latency suite with env from backend/.env (+ .env.local).
 *
 *   npm run k6:latency
 *   npm run k6:latency -- --businessId=<uuid>
 *
 * Same fixture rules as k6:correctness (STAFF_IDS / SERVICE_IDS / CUSTOMER_IDS or DATABASE_URL).
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
  const t = String(raw)
    .trim()
    .replace(/^Bearer\s+/i, '');
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

function mintLongLivedTestToken(shortToken) {
  try {
    const jwt = require('jsonwebtoken');
    const secret = String(process.env.JWT_SECRET ?? '').trim();
    if (!secret) return shortToken;
    const decoded = jwt.decode(shortToken);
    if (!decoded || typeof decoded !== 'object') return shortToken;
    const { iat: _i, exp: _e, nbf: _n, ...payload } = decoded;
    return jwt.sign(payload, secret, { expiresIn: '2h' });
  } catch {
    return shortToken;
  }
}

function applyLongLivedAuth() {
  const t = String(process.env.AUTH_TOKEN || '').trim();
  if (!t) return;
  const minted = mintLongLivedTestToken(t);
  process.env.AUTH_TOKEN = minted;
  process.env.K6_AUTH_TOKEN = minted;
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

function envListNonEmpty(name) {
  const v = (process.env[name] || '').trim();
  if (!v) return false;
  return v.split(',').some((s) => s.trim().length > 0);
}

function mergeK6FixtureFromDbIfNeeded() {
  const businessId = (process.env.BUSINESS_ID || process.env.TEST_BUSINESS_ID || '').trim();
  if (!businessId) return;
  const hasStaff = envListNonEmpty('STAFF_IDS');
  const hasSvc = envListNonEmpty('SERVICE_IDS');
  const hasCust = envListNonEmpty('CUSTOMER_IDS');
  if (hasStaff && hasSvc && hasCust) return;
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (!dbUrl) {
    console.warn('\n# k6:latency: no DB fixture env; booking-latency.test.js will resolve fixture via API\n');
    return;
  }
  const tsNode = path.join(backendRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const script = path.join(backendRoot, 'scripts', 'k6-resolve-fixture-from-db.ts');
  const r = spawnSync(process.execPath, [tsNode, script], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: { ...process.env, BUSINESS_ID: businessId },
  });
  if ((r.status ?? 1) !== 0) {
    console.warn(r.stderr || r.stdout || 'k6-resolve-fixture-from-db failed');
    console.warn('\n# k6:latency: falling back to API-based fixture resolution inside the k6 test\n');
    return;
  }
  const lines = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  let data;
  try {
    data = JSON.parse(lines[lines.length - 1]);
  } catch {
    console.error('k6:resolve-fixture: invalid JSON', (r.stdout || '').slice(-400));
    process.exit(1);
  }
  if (!hasStaff && data.staffIds?.length) process.env.STAFF_IDS = data.staffIds.join(',');
  if (!hasSvc && data.serviceIds?.length) process.env.SERVICE_IDS = data.serviceIds.join(',');
  if (!hasCust && data.customerIds?.length) process.env.CUSTOMER_IDS = data.customerIds.join(',');
  const dur = (data.k6ServiceDurations || '').trim();
  if (dur && !(process.env.K6_SERVICE_DURATIONS || '').trim()) process.env.K6_SERVICE_DURATIONS = dur;
}

loadBackendEnvFiles();
applyBusinessIdFromArgv(extraArgs);
normalizeBusinessId();
normalizeAuthToken();
applyLongLivedAuth();

const bid = (process.env.BUSINESS_ID || '').trim();
const tok = (process.env.AUTH_TOKEN || '').trim();
if (!bid) {
  console.error('Missing BUSINESS_ID');
  process.exit(1);
}
if (!tok) {
  console.error('Missing AUTH_TOKEN');
  process.exit(1);
}

mergeK6FixtureFromDbIfNeeded();

console.log(`k6:latency → businessId=${bid.slice(0, 8)}… (~3m30s stages)\n`);

const r = spawnSync('k6', ['run', 'k6/booking-latency.test.js'], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
process.exit(r.status ?? 0);
