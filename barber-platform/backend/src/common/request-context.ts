import { AsyncLocalStorage } from 'async_hooks';

/** One Prisma Client call as seen by `$use` middleware (BOOKING_PERF_LOG). */
export interface PrismaMiddlewareQueryRecord {
  model: string;
  action: string;
  durationMs: number;
}

export interface PrismaQueryEventRecord {
  durationMs: number;
  target?: string;
  sql: string;
  params?: string;
}

export interface RequestContext {
  requestId: string;
  requestStartMs?: number;
  tenantId?: string; // businessId
  userId?: string;
  endpoint?: string;
  /** Cumulative wall-clock time spent in Prisma operations for this request (see PrismaService $use when BOOKING_PERF_LOG=1). */
  prismaDurationMsTotal?: number;
  /** Per-call records for the same request; reset with {@link resetPrismaQueryDurationMs}. */
  prismaQueries?: PrismaMiddlewareQueryRecord[];
  /** Prisma query-engine events in request order; includes SQL text for raw statements. */
  prismaQueryEvents?: PrismaQueryEventRecord[];
  /** Count of Redis/cache operations observed through CacheService for this request. */
  redisCallCount?: number;
  appointmentCreateTrace?: {
    enabled: boolean;
    currentPhase?: string;
    insideTransaction: boolean;
    txCumulativeMs: number;
    entries: Array<{
      phaseName: string;
      model: string;
      action: string;
      durationMs: number;
      cumulativeTxMs: number;
      insideTransaction: boolean;
    }>;
  };
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getRequestId(): string {
  return getRequestContext()?.requestId ?? 'no-request-id';
}

export function setRequestEndpoint(endpoint: string | undefined): void {
  const ctx = getRequestContext();
  if (!ctx) return;
  ctx.endpoint = endpoint;
}

export function getRequestEndpoint(): string | undefined {
  return getRequestContext()?.endpoint;
}

/** Format for structured logging: requestId, tenantId, userId */
export function getLogContext(): Record<string, string | undefined> {
  const ctx = getRequestContext();
  if (!ctx) return {};
  return {
    requestId: ctx.requestId,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  };
}

export function resetPrismaQueryDurationMs(): void {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.prismaDurationMsTotal = 0;
    ctx.prismaQueries = [];
    ctx.prismaQueryEvents = [];
    ctx.redisCallCount = 0;
  }
}

export function addPrismaQueryDuration(ms: number): void {
  const ctx = getRequestContext();
  if (!ctx || !Number.isFinite(ms)) return;
  ctx.prismaDurationMsTotal = (ctx.prismaDurationMsTotal ?? 0) + Math.max(0, Math.round(ms));
}

/** Append one middleware invocation (same wall window as {@link addPrismaQueryDuration}). */
export function addPrismaMiddlewareQueryRecord(
  model: string | undefined,
  action: string,
  durationMs: number,
): void {
  const ctx = getRequestContext();
  if (!ctx || !Number.isFinite(durationMs)) return;
  if (!ctx.prismaQueries) ctx.prismaQueries = [];
  ctx.prismaQueries.push({
    model: model ?? 'raw',
    action,
    durationMs: Math.max(0, Math.round(durationMs)),
  });
}

export function getPrismaMiddlewareQueryRecords(): readonly PrismaMiddlewareQueryRecord[] {
  return getRequestContext()?.prismaQueries ?? [];
}

export function addPrismaQueryEventRecord(record: PrismaQueryEventRecord): void {
  const ctx = getRequestContext();
  if (!ctx || !Number.isFinite(record.durationMs)) return;
  if (!ctx.prismaQueryEvents) ctx.prismaQueryEvents = [];
  ctx.prismaQueryEvents.push({
    durationMs: Math.max(0, Math.round(record.durationMs)),
    target: record.target,
    sql: record.sql,
    params: record.params,
  });
}

export function getPrismaQueryEventRecords(): readonly PrismaQueryEventRecord[] {
  return getRequestContext()?.prismaQueryEvents ?? [];
}

export function getPrismaQueryDurationMs(): number | undefined {
  const ctx = getRequestContext();
  if (ctx == null || ctx.prismaDurationMsTotal == null) return undefined;
  return ctx.prismaDurationMsTotal;
}

export function addRedisCallCount(count = 1): void {
  const ctx = getRequestContext();
  if (!ctx || !Number.isFinite(count)) return;
  ctx.redisCallCount = (ctx.redisCallCount ?? 0) + Math.max(0, Math.trunc(count));
}

export function getRedisCallCount(): number {
  return getRequestContext()?.redisCallCount ?? 0;
}

export function startAppointmentCreateTrace(): void {
  const ctx = getRequestContext();
  if (!ctx) return;
  ctx.appointmentCreateTrace = {
    enabled: true,
    currentPhase: 'init',
    insideTransaction: false,
    txCumulativeMs: 0,
    entries: [],
  };
}

export function stopAppointmentCreateTrace(): void {
  const ctx = getRequestContext();
  if (!ctx?.appointmentCreateTrace) return;
  ctx.appointmentCreateTrace.enabled = false;
}

export function setAppointmentCreateTracePhase(phaseName: string): void {
  const ctx = getRequestContext();
  if (!ctx?.appointmentCreateTrace) return;
  ctx.appointmentCreateTrace.currentPhase = phaseName;
}

export function setAppointmentCreateTraceInsideTransaction(insideTransaction: boolean): void {
  const ctx = getRequestContext();
  if (!ctx?.appointmentCreateTrace) return;
  ctx.appointmentCreateTrace.insideTransaction = insideTransaction;
}

export function addAppointmentCreateTraceQuery(
  model: string | undefined,
  action: string,
  durationMs: number,
): void {
  const ctx = getRequestContext();
  const trace = ctx?.appointmentCreateTrace;
  if (!trace?.enabled || !Number.isFinite(durationMs)) return;
  const rounded = Math.max(0, Math.round(durationMs));
  if (trace.insideTransaction) {
    trace.txCumulativeMs += rounded;
  }
  trace.entries.push({
    phaseName: trace.currentPhase ?? 'unknown',
    model: model ?? 'raw',
    action,
    durationMs: rounded,
    cumulativeTxMs: trace.txCumulativeMs,
    insideTransaction: trace.insideTransaction,
  });
}

export function getAppointmentCreateTraceEntries(): Array<{
  phaseName: string;
  model: string;
  action: string;
  durationMs: number;
  cumulativeTxMs: number;
  insideTransaction: boolean;
}> {
  return getRequestContext()?.appointmentCreateTrace?.entries ?? [];
}
