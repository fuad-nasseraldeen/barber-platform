# Failure Injection (Advanced)

These scenarios require external tooling or dev-only server hooks.

## External proxy (recommended)

Use [Toxiproxy](https://github.com/Shopify/toxiproxy) to inject latency/failures between API and Postgres/Redis:

```bash
# Add proxy for Postgres
toxiproxy-cli create pg -l 0.0.0.0:15432 -u <db-host>:5432

# Inject 500ms latency
toxiproxy-cli toxic add pg -t latency -a latency=500

# Inject random connection resets (5% of connections)
toxiproxy-cli toxic add pg -t reset_peer -a timeout=0 -a toxicity=0.05
```

Point `DATABASE_URL` at the proxy and run any test suite. The invariants should still pass (no double booking, no overlaps) even under degraded DB.

## Redis failure simulation

```bash
toxiproxy-cli create redis -l 0.0.0.0:16379 -u <redis-host>:6379
toxiproxy-cli toxic add redis -t latency -a latency=1000
```

With Redis slow or down, availability should still be correct (DB is source of truth). Cache-consistency tests may see degraded latency but must not see stale reads if the availability redesign is in place.

## Server-side hooks (dev only)

If you add optional delay hooks to the codebase:

```
BOOKING_SIMULATE_DB_DELAY_MS=200     # artificial Prisma query delay
BOOKING_SIMULATE_REDIS_DELAY_MS=500  # artificial Redis op delay
```

Guard them with `NODE_ENV !== 'production'` checks. Run the property or longrun tests with these set.

## What to verify

Under any failure injection:

- [ ] `APPOINTMENT_OVERLAP` count = 0
- [ ] `SLOT_HOLD_OVERLAP` count = 0
- [ ] `APPOINTMENT_VS_HOLD_OVERLAP` count = 0
- [ ] No HTTP 500 on booking endpoints (graceful degradation)
- [ ] Race test still produces exactly 1 winner
