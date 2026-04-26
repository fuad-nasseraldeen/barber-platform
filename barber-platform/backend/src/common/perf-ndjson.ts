import { getRequestContext, getRequestId } from './request-context';

/**
 * One NDJSON line on stdout (no Nest `[Nest] ... [Context]` prefix).
 * `requestId` is always taken from AsyncLocalStorage (last wins — cannot be overridden by `record`).
 */
/** Minimal hot-path line when `HOT_PATH_PERF_LOG=1` (duration + DB sum); full detail still needs `BOOKING_PERF_LOG=1`. */
export function writeHotPathPerfNdjson(record: Record<string, unknown>): void {
  if (process.env.HOT_PATH_PERF_LOG !== '1') return;
  const ctx = getRequestContext();
  const payload: Record<string, unknown> = { ...record };
  if (ctx?.tenantId != null) payload.tenantId = ctx.tenantId;
  if (ctx?.userId != null) payload.userId = ctx.userId;
  payload.requestId = ctx?.requestId ?? getRequestId();
  try {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch {
    /* ignore */
  }
}

export function writePerfNdjson(record: Record<string, unknown>): void {
  if (process.env.BOOKING_PERF_LOG !== '1') return;
  const ctx = getRequestContext();
  const payload: Record<string, unknown> = { ...record };
  if (ctx?.tenantId != null) payload.tenantId = ctx.tenantId;
  if (ctx?.userId != null) payload.userId = ctx.userId;
  payload.requestId = ctx?.requestId ?? getRequestId();
  try {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch {
    /* ignore */
  }
}
