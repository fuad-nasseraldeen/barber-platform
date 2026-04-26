import { Logger } from '@nestjs/common';
import { getPrismaErrorDiagnostics, isTransientInsertFailure } from './prisma-error-helpers';

/** Serialization failures (deadlock / P2034 / PG 40001): bounded retries to clear transient contention. */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 50;

function isSerializationError(e: unknown): boolean {
  return isTransientInsertFailure(e);
}

/** Pool saturated / default maxWait too low — safe to retry with backoff. */
function isTransactionAcquireTimeout(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'P2028') return true;
  return /Unable to start a transaction in the given time/i.test(err?.message ?? '');
}

function isRetryableTransactionError(e: unknown): boolean {
  return isSerializationError(e) || isTransactionAcquireTimeout(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 50;
}

export type OnRetryCallback = (attempt: number) => void;

/**
 * Run a transaction with optional retry on serialization failure only.
 * Retries up to MAX_RETRIES on deadlock / serialization only.
 */
export async function withTransactionRetry<T>(
  runTransaction: () => Promise<T>,
  logger?: Logger,
  onRetry?: OnRetryCallback,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await runTransaction();
    } catch (e) {
      lastError = e;
      if (!isRetryableTransactionError(e) || attempt === MAX_RETRIES - 1) {
        if (isRetryableTransactionError(e) && attempt === MAX_RETRIES - 1) {
          const { prismaCode, errorChain } = getPrismaErrorDiagnostics(e);
          logger?.warn(
            `[Transaction] Exhausted ${MAX_RETRIES} attempts (serialization / pool timeout); failing`,
            {
              prismaCode,
              errorMessage: (e as Error)?.message,
              errorChain: errorChain.slice(0, 1200),
            },
          );
        }
        throw e;
      }
      onRetry?.(attempt + 1);
      const delay = backoff(attempt);
      logger?.warn(
        `[Transaction] Serialization conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`,
        { error: (e as Error)?.message },
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
