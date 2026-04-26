import { ConfigService } from '@nestjs/config';

/**
 * Legacy flag. When true, synchronous regeneration used to run after schedule changes (removed).
 * Precompute is always queue-driven when Redis is enabled; this no longer disables the worker/cron.
 */
export function deterministicAvailabilityEnabled(config: ConfigService): boolean {
  return config.get<string>('DETERMINISTIC_AVAILABILITY', 'false') === 'true';
}

/**
 * When true and the DB has zero availability_slots rows for (staffId, date), GET grid can 503 (not recommended).
 */
export function availabilityFailOnMissingPrecompute(config: ConfigService): boolean {
  return config.get<string>('AVAILABILITY_FAIL_ON_MISSING_PRECOMPUTE', 'false') === 'true';
}

/** When true, never 503 on missing precompute (still logs). */
export function availabilityAllowEmptyGrid(config: ConfigService): boolean {
  return config.get<string>('AVAILABILITY_ALLOW_EMPTY_GRID', 'false') === 'true';
}
