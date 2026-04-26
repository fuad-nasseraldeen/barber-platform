import { ConfigService } from '@nestjs/config';

/** Values that divide 60 so HH:mm grid steps stay aligned across hour boundaries. */
const ALLOWED = new Set([5, 10, 15, 30]);

/**
 * Ledger anchors / lock-slot alignment (minutes). Used where the DB or lock keys need a coarse grid.
 */
export function getAvailabilitySlotIntervalMinutes(config: ConfigService): number {
  const raw = config.get<string>('AVAILABILITY_SLOT_INTERVAL_MINUTES', '10');
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && ALLOWED.has(n)) return n;
  return 15;
}

/** Step between offered *start times* in interval-based availability (minutes). Default 5. */
const ALLOWED_STEP = new Set([1, 2, 3, 5, 6, 10, 12, 15, 20, 30]);

export function getAvailabilitySlotStepMinutes(config: ConfigService): number {
  const raw = config.get<string>('AVAILABILITY_SLOT_STEP_MINUTES', '5');
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && ALLOWED_STEP.has(n)) return n;
  return 5;
}
