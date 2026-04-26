/**
 * Reports whether critical env keys exist in .env (no values printed).
 * Run: node scripts/check-env-presence.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.log('.env: MISSING at', envPath);
  console.log('Copy .env.example → .env and fill values.');
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');
function get(key) {
  const m = raw.match(new RegExp('^' + key + '=(.*)$', 'm'));
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  return v || null;
}

function looksPlaceholder(v, key) {
  if (!v) return true;
  if (/^xxx|PASSWORD|your-super-secret|PLACEHOLDER|PROJECT_REF$/i.test(v)) return true;
  if (key === 'REDIS_PORT') return !/^\d{2,5}$/.test(v);
  if (key === 'ENABLE_REDIS') return !/^(true|false)$/i.test(v);
  if (v.length < 8) return true;
  return false;
}

const keys = [
  ['DATABASE_URL', true],
  ['DIRECT_URL', true],
  ['REDIS_URL', false],
  ['REDIS_HOST', false],
  ['REDIS_PORT', false],
  ['REDIS_PASSWORD', false],
  ['ENABLE_REDIS', false],
];

console.log('.env: found\n');
for (const [k, required] of keys) {
  const v = get(k);
  let status;
  if (v == null) status = required ? 'NOT SET (required for Prisma)' : 'NOT SET';
  else if (looksPlaceholder(v, k)) status = 'SET but invalid / placeholder';
  else status = 'OK';
  console.log(`  ${k}: ${status}`);
}

const redisOff = get('ENABLE_REDIS') === 'false';
if (redisOff) {
  console.log('\n  Note: ENABLE_REDIS=false — app may run without Redis (degraded).');
}
