/**
 * PM2 cluster: only instance 0 should run @Cron / interval DB jobs (avoids N× duplicate work).
 * PM2 sets NODE_APP_INSTANCE to 0..N-1 in cluster mode.
 * Single-process / nest start: variable unset → run schedulers (backward compatible).
 */
export function isSchedulerPrimaryInstance(): boolean {
  if (process.env.DISABLE_SCHEDULER === '1' || process.env.DISABLE_SCHEDULER === 'true') {
    return false;
  }
  const raw = process.env.NODE_APP_INSTANCE;
  if (raw === undefined || raw === '') {
    return true;
  }
  const n = parseInt(String(raw), 10);
  return !Number.isNaN(n) && n === 0;
}

/** Stagger DB-heavy timers across processes (ms). */
export function schedulerStartupStaggerMs(): number {
  return 5000 + (process.pid % 3) * 2000;
}
