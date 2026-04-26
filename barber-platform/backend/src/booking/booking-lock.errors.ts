/** Stable API codes for booking-from-hold failures (check HTTP body `code`). */

/** HTTP 409 body `code` when DB overlap / unique / exclusion rejects the insert. */
export const BOOKING_SLOT_CONFLICT_CODE = 'SLOT_ALREADY_BOOKED';

/** Human-readable message (body `message`); clients should prefer {@link BOOKING_SLOT_CONFLICT_CODE}. */
export const BOOKING_SLOT_CONFLICT_MESSAGE = 'Slot already taken';

/**
 * POST slot-holds: race vs another client or read skew — user-facing copy (body `code` / `message`).
 * Pair with `refreshAvailability: true` in JSON when supported by the API filter.
 */
export const HOLD_SLOT_RACE_CODE = 'SLOT_JUST_TAKEN';
export const HOLD_SLOT_RACE_MESSAGE =
  'This slot was just taken. Please choose another.';

/**
 * {@link ComputedAvailabilityService.assertSlotHoldOfferedByAvailabilityEngine} uses this when the
 * engine no longer lists the slot (busy/holds/cap). Under concurrency, that can mean another client
 * just took it — {@link BookingService.createSlotHoldForSlotSelection} re-checks DB and may map to 409.
 */
export const SLOT_ASSERT_UNAVAILABLE_MESSAGE = 'Selected time is not available';

export const HOLD_EXPIRED = 'HOLD_EXPIRED';
export const HOLD_NOT_FOUND = 'HOLD_NOT_FOUND';
export const HOLD_ALREADY_USED = 'HOLD_ALREADY_USED';
export const HOLD_BUSINESS_MISMATCH = 'HOLD_BUSINESS_MISMATCH';
export const HOLD_FORBIDDEN = 'HOLD_FORBIDDEN';
