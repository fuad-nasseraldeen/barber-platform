const path = require('path');

// ConfigModule loads .env relative to process.cwd(). Without cwd here, starting PM2 from
// another directory skips backend/.env → missing JWT_SECRET / DB URL → 500 on auth/google, etc.
module.exports = {
  apps: [
    {
      name: 'barber-backend',
      cwd: __dirname,
      script: path.join(__dirname, 'dist/src/main.js'),
      instances: '2',
      exec_mode: 'cluster',
      instance_var: 'NODE_APP_INSTANCE',
      env: {
        NODE_ENV: 'production',
        ENABLE_QUEUE_WORKERS: 'true',
        ENABLE_AVAILABILITY_WORKER: 'true',
        ENABLE_AVAILABILITY_PRECOMPUTE_CRON: 'true',
      },
    },
  ],
};
