import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

/** Public fields on Prisma known-request errors (also when duplicate packages break `instanceof`). */
export type PrismaKnownRequestLike = {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
};

function prismaKnownCodeString(o: Record<string, unknown>): string {
  const c = o.code;
  if (typeof c === 'string') return c;
  if (typeof c === 'number' && Number.isFinite(c)) return `P${c}`;
  return '';
}

function isPrismaKnownRequestLike(
  cur: unknown,
): cur is { code: string; message: string; meta?: unknown } {
  if (typeof cur !== 'object' || cur === null) return false;
  const o = cur as Record<string, unknown>;
  const codeStr = prismaKnownCodeString(o);
  return typeof o.message === 'string' && /^P\d{4}$/.test(codeStr);
}

function appendPrismaKnownLayer(cur: unknown, parts: string[]): boolean {
  if (cur instanceof PrismaClientKnownRequestError) {
    parts.push(cur.message);
    parts.push(JSON.stringify(cur.meta ?? {}));
    return true;
  }
  if (isPrismaKnownRequestLike(cur)) {
    parts.push(cur.message);
    parts.push(JSON.stringify(cur.meta ?? {}));
    return true;
  }
  return false;
}

function resolveBookingInsertMaxAttempts(): number {
  const raw = process.env.BOOKING_INSERT_MAX_ATTEMPTS;
  if (raw != null && raw !== '') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 10);
  }
  return 3;
}

/** Env `BOOKING_INSERT_MAX_ATTEMPTS` (default 3, max 10). Use 1 under load tests / fail-fast on contention. */
export const BOOKING_INSERT_MAX_ATTEMPTS = resolveBookingInsertMaxAttempts();

/** Walk Error.cause — nested PG / driver codes often sit below the Prisma wrapper. */
export function collectPrismaErrorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 12; depth++) {
    if (appendPrismaKnownLayer(cur, parts)) {
      /* includes `meta` so PG SQLSTATE survives */
    } else if (cur instanceof Error) {
      parts.push(cur.message);
      const possibleCode = (cur as unknown as Record<string, unknown>).code;
      if (typeof possibleCode === 'string' && possibleCode.startsWith('P')) {
        parts.push(`code=${possibleCode}`);
      }
    } else if (typeof cur === 'object' && cur !== null && 'message' in cur) {
      parts.push(String((cur as { message: unknown }).message));
    }
    cur = (cur as { cause?: unknown })?.cause;
  }
  return parts.join(' | ');
}

/** Walk `cause` — supports duplicate `@prisma/client` where `instanceof` fails on the same error shape. */
export function findPrismaKnownRequestError(e: unknown): PrismaKnownRequestLike | undefined {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 12; depth++) {
    if (cur instanceof PrismaClientKnownRequestError) {
      return {
        code: cur.code,
        message: cur.message,
        meta: cur.meta as Record<string, unknown> | undefined,
      };
    }
    if (isPrismaKnownRequestLike(cur)) {
      const o = cur as Record<string, unknown>;
      return {
        code: prismaKnownCodeString(o),
        message: cur.message,
        meta: cur.meta as Record<string, unknown> | undefined,
      };
    }
    cur = (cur as { cause?: unknown })?.cause;
  }
  return undefined;
}

export function isPrismaForeignKeyViolation(e: unknown): boolean {
  return findPrismaKnownRequestError(e)?.code === 'P2003';
}

/** Unique violation (P2002), e.g. `slotHoldId`, `(businessId, idempotencyKey)`. */
export function isPrismaUniqueViolation(e: unknown): boolean {
  const known = findPrismaKnownRequestError(e);
  if (known?.code === 'P2002') return true;
  const text = collectPrismaErrorText(e);
  if (/Unique constraint failed/i.test(text)) return true;
  if (/\bP2002\b/.test(text)) return true;
  return false;
}

/** P2002 `meta.target` when Prisma provides it (e.g. `['slotKey']`, `['businessId','idempotencyKey']`). */
export function prismaUniqueViolationTargets(e: unknown): string[] {
  const known = findPrismaKnownRequestError(e);
  if (known?.code !== 'P2002' || known.meta?.target == null) return [];
  const t = known.meta.target;
  if (!Array.isArray(t)) return [];
  return t.filter((x): x is string => typeof x === 'string');
}

/**
 * Legacy: appointments used a global unique `slotKey` (removed). Kept so idempotency replay
 * logic does not mis-handle errors if an old DB is still deployed.
 */
export function isPrismaUniqueViolationOnAppointmentSlotKey(e: unknown): boolean {
  const targets = prismaUniqueViolationTargets(e);
  if (targets.length > 0) {
    if (targets.includes('idempotencyKey')) return false;
    return targets.includes('slotKey');
  }
  const text = collectPrismaErrorText(e);
  if (!/Unique constraint failed/i.test(text)) return false;
  if (/\bidempotencyKey\b/i.test(text)) return false;
  return /\(`slotKey`\)|\bslotKey\b/i.test(text);
}

/**
 * EXCLUDE overlap for staff appointments — PostgreSQL 23P01.
 * Prefer Prisma `P2010` (raw engine) + SQLSTATE; fall back to nested 23P01 text only.
 */
export function isPrismaExclusion23P01(e: unknown): boolean {
  const text = collectPrismaErrorText(e);
  /** PostgreSQL 23P01 is only `exclusion_violation` (e.g. EXCLUDE USING gist on appointments). */
  if (/\b23P01\b/i.test(text)) return true;
  if (/exclusion constraint/i.test(text)) return true;
  return false;
}

/** Shared by `HttpExceptionFilter` and booking — PG / Prisma text signals for duplicate slot or contention. */
export function isConcurrencyOrDuplicateDbChain(chain: string): boolean {
  if (!chain) return false;
  return (
    /Unique constraint failed/i.test(chain) ||
    /\bP2002\b/i.test(chain) ||
    /\b23P01\b/i.test(chain) ||
    /\bP2034\b/i.test(chain) ||
    /\bP2010\b/i.test(chain) ||
    /(?:^|[^0-9])40001(?:[^0-9]|$)/.test(chain) ||
    /\b40P01\b/i.test(chain) ||
    /serialization failure/i.test(chain) ||
    /serialization_failure/i.test(chain) ||
    /could not serialize access/i.test(chain) ||
    /could not serialize\b/i.test(chain) ||
    /due to concurrent update/i.test(chain) ||
    /concurrent update/i.test(chain) ||
    (/raw query failed/i.test(chain) &&
      (/40001|serialize|concurrent|23P01|exclusion/i.test(chain))) ||
    /exclusion constraint/i.test(chain) ||
    /\$queryRawUnsafe/i.test(chain)
  );
}

export function getPrismaErrorDiagnostics(e: unknown): {
  prismaCode?: string;
  meta?: Record<string, unknown>;
  errorChain: string;
} {
  const errorChain = collectPrismaErrorText(e);
  const known = findPrismaKnownRequestError(e);
  if (known) {
    return {
      prismaCode: known.code,
      meta: known.meta as Record<string, unknown>,
      errorChain,
    };
  }
  return { errorChain };
}

/**
 * Transient: should retry, not map to 409.
 * - P2034: transaction / serialization failure
 * - PostgreSQL 40P01 (deadlock), 40001 (serialization_failure) when surfaced in text
 */
export function isTransientInsertFailure(e: unknown): boolean {
  const known = findPrismaKnownRequestError(e);
  if (known?.code === 'P2034') {
    return true;
  }
  /** Raw query (`$queryRawUnsafe`): serialization/deadlock as P2010 + PG code in meta. */
  if (known?.code === 'P2010') {
    const text = collectPrismaErrorText(e);
    if (/\b40001\b/i.test(text)) return true;
    if (/\b40P01\b/i.test(text)) return true;
    if (/serialization failure/i.test(text)) return true;
    if (/could not serialize access/i.test(text)) return true;
    /** Some drivers surface only `serialization_failure` without numeric SQLSTATE in text. */
    if (/serialization_failure/i.test(text)) return true;
  }
  const text = collectPrismaErrorText(e);
  if (/\b40P01\b/i.test(text)) return true;
  if (/\b40001\b/i.test(text)) return true;
  if (/deadlock detected/i.test(text)) return true;
  if (/serialization failure/i.test(text)) return true;
  if (/could not serialize access/i.test(text)) return true;
  if (/serialization_failure/i.test(text)) return true;
  return false;
}

/**
 * After retries: map to HTTP 409 for contention / duplicate (duck-typed Prisma errors included).
 */
export function isBookingFinalConflictError(e: unknown): boolean {
  if (isPrismaUniqueViolation(e) || isPrismaExclusion23P01(e)) return true;
  if (isTransientInsertFailure(e)) return true;
  return isConcurrencyOrDuplicateDbChain(collectPrismaErrorText(e));
}

export function bookingInsertRetryDelayMs(attemptIndex: number): number {
  return 35 * Math.pow(2, attemptIndex) + Math.random() * 40;
}
