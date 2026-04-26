# Availability consistency model

## Layers

| Layer | Role |
|--------|------|
| **GET /availability** | UX: Redis-backed grids + optional DB read-repair + write bust. **Eventually consistent** — may lag behind the DB for a short window. |
| **POST …/slot-holds** | **Best-effort reservation**: validates against the same engine as GET when possible, then **DB** (`appointments` overlap + `slot_holds` EXCLUDE) decides. Can return **409** if another client took the slot first. |
| **POST …/book** | **DB is final authority** (uniqueness, exclusion, constraints). No availability “prediction” in the confirm path. |

You **cannot** remove races between “read grid” and “write hold” without distributed locking; the system **manages** them: bust caches, read-repair near-term days, metrics, and friendly **409** responses.

## Rates and metrics

In-process counters on **GET `appointments/metrics`** (per `businessId`):

- **`availabilityInconsistencyRate`** — `slotHoldConflictAfterAssertCount / slotHoldAttemptAfterAssertCount` (hold **409** after the slot was asserted from the availability engine).
- **`bookingConflictRate`** — `bookingConflictCount / bookingAttemptCount`.

**Target SLOs** (documented as `acceptableRates` on the same endpoint; not auto-alerts):

- Inconsistency rate: aim **below ~1–2%**.
- Booking conflict rate: aim **below ~1%**.

Structured log on hold conflict (default **on**; set `LOG_AVAILABILITY_HOLD_RACE=0` to silence):

- `type: availability_hold_race`, `staffId`, `date`, `slot`, `timestamp`, current rates, `acceptableRates`.

## Client handling (409 on hold)

Response body may include:

- `code`: `SLOT_JUST_TAKEN`
- `message`: user-facing explanation
- `refreshAvailability`: `true` — **re-fetch** GET /availability before showing slots again.

Booking confirm still uses `SLOT_ALREADY_BOOKED` where applicable.

## Read-repair scope (performance)

By default, the extra DB UNION for read-repair runs only when the requested window overlaps **today … today+N** business days (`AVAILABILITY_READ_REPAIR_CHURN_WINDOW_DAYS`, default `7`). Set `AVAILABILITY_READ_REPAIR_ALWAYS=1` to always run read-repair for any in-window request.

## Related env

- `AVAILABILITY_READ_REPAIR` — `0` disables read-repair (not recommended for production UX).
- `LOG_AVAILABILITY_HOLD_RACE` — `0` disables hold-race warn logs.
