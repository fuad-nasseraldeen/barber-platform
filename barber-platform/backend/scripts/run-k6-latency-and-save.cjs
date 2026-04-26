const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.join(__dirname, '..');
const logsDir = path.join(backendRoot, 'logs');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampForFile(date = new Date()) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    '-',
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('');
}

function append(filePath, text) {
  fs.appendFileSync(filePath, text, 'utf8');
}

function runAndCapture(command, args, filePath, title) {
  const startedAt = new Date();
  append(
    filePath,
    `\n=== ${title} | ${startedAt.toISOString()} ===\n`,
  );

  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
    append(filePath, result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
    append(filePath, result.stderr);
  }

  append(
    filePath,
    `\n[exit_code=${result.status ?? 1}] ${title}\n`,
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

fs.mkdirSync(logsDir, { recursive: true });

const stamp = timestampForFile();
const filePath = path.join(logsDir, `k6-latency-${stamp}.log`);

append(
  filePath,
  `# k6 latency + post-k6 invariants\n# created_at=${new Date().toISOString()}\n# cwd=${backendRoot}\n`,
);

console.log(`Saving run output to ${filePath}\n`);

const latencyExit = runAndCapture(
  'npm',
  ['run', 'k6:latency'],
  filePath,
  'npm run k6:latency',
);

const invariantExit = runAndCapture(
  'npm',
  ['run', 'test:booking:post-k6'],
  filePath,
  'npm run test:booking:post-k6',
);

console.log(`\nSaved run output to ${filePath}`);

process.exit(latencyExit !== 0 ? latencyExit : invariantExit);
