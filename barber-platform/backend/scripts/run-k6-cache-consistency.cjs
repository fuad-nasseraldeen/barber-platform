/**
 * k6 cache-consistency wrapper (k6/booking-cache-consistency.test.js).
 *
 *   npm run k6:cache-consistency
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(backendRoot, '.env');
  const localPath = path.join(backendRoot, '.env.local');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
}

function normalize() {
  const raw = process.env.AUTH_TOKEN || process.env.K6_AUTH_TOKEN || '';
  const t = String(raw).trim().replace(/^Bearer\s+/i, '');
  if (t) { process.env.AUTH_TOKEN = t; process.env.K6_AUTH_TOKEN = t; }

  const id = (process.env.BUSINESS_ID || process.env.TEST_BUSINESS_ID || '').trim();
  if (id) { process.env.BUSINESS_ID = id; process.env.TEST_BUSINESS_ID = id; }
}

/**
 * Re-sign JWT with 2h TTL so k6 still works when this script runs last in
 * test:booking:all (short-lived access tokens expire mid-chain).
 */
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

loadEnv();
normalize();
applyLongLivedAuth();

const bid = (process.env.BUSINESS_ID || '').trim();
const tok = (process.env.AUTH_TOKEN || '').trim();
if (!bid) { console.error('Missing BUSINESS_ID.'); process.exit(1); }
if (!tok) { console.error('Missing AUTH_TOKEN.'); process.exit(1); }

console.log(`k6:cache-consistency → businessId=${bid.slice(0, 8)}…\n`);

const r = spawnSync('k6', ['run', 'k6/booking-cache-consistency.test.js'], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}

// Run post-k6 invariant check
console.log('\nRunning post-k6 DB invariant check...\n');
const inv = spawnSync(
  'npx',
  ['ts-node', 'scripts/booking-tests/cli/post-k6-invariants.ts'],
  {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  },
);

const k6Exit = r.status ?? 0;
const invExit = inv.status ?? 0;
process.exit(k6Exit !== 0 ? k6Exit : invExit);
