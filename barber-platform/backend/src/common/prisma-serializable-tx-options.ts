import { Prisma } from '@prisma/client';

function parseMs(env: string | undefined, fallback: number): number {
  const n = parseInt(String(env ?? ''), 10);
  return Number.isFinite(n) && n >= 1000 ? n : fallback;
}

/** maxWait / timeout for any interactive $transaction (pool pressure under load). */
export function getBookingTxInteractionLimits(): { maxWait: number; timeout: number } {
  return {
    maxWait: parseMs(process.env.PRISMA_TX_MAX_WAIT_MS, 12_000),
    timeout: parseMs(process.env.PRISMA_TX_TIMEOUT_MS, 25_000),
  };
}

/**
 * Serializable booking writes — use with withTransactionRetry (P2034 / P2028).
 */
export function getBookingSerializableTxOptions(): {
  isolationLevel: Prisma.TransactionIsolationLevel;
  maxWait: number;
  timeout: number;
} {
  return {
    ...getBookingTxInteractionLimits(),
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };
}

/** Single-row FOR UPDATE + short writes — lower latency than Serializable for POST /appointments/book. */
export function getBookingAtomicBookTxOptions(): {
  isolationLevel: Prisma.TransactionIsolationLevel;
  maxWait: number;
  timeout: number;
} {
  return {
    ...getBookingTxInteractionLimits(),
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  };
}
