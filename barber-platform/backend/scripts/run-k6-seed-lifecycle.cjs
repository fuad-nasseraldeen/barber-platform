/**
 * Run k6 booking-seed-lifecycle.test.js with AUTH_TOKEN from backend/.env (+ .env.local).
 *
 *   npm run k6:seed-lifecycle
 *
 * The script uses fixed UUIDs from prisma/seed.ts (not BUSINESS_ID from .env).
 * Run `npm run seed` on the same database first.
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

loadBackendEnvFiles();
normalizeAuthToken();

const tok = stripQuotes(process.env.AUTH_TOKEN || '');
if (!tok) {
  console.error('Missing AUTH_TOKEN in backend/.env (or K6_AUTH_TOKEN).');
  process.exit(1);
}

console.log('k6:seed-lifecycle → AUTH_TOKEN from .env\n');

const r = spawnSync('k6', ['run', 'k6/booking-seed-lifecycle.test.js'], {
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
