-- Atomic slot-hold acquisition: single DB round-trip instead of interactive transaction.
-- Uses advisory lock on staff_id hash to serialize concurrent hold attempts for the same staff,
-- then checks appointment overlap, then INSERT with EXCLUDE as final guard.

CREATE OR REPLACE FUNCTION try_acquire_slot_hold(
  p_business_id TEXT,
  p_staff_id TEXT,
  p_customer_id TEXT,
  p_service_id TEXT,
  p_user_id TEXT,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(
  hold_id TEXT,
  staff_id TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  conflict BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize concurrent hold attempts for the same staff (released at end of transaction)
  PERFORM pg_advisory_xact_lock(hashtext(p_staff_id));

  -- Check for overlapping active appointments (cross-table guard)
  IF EXISTS (
    SELECT 1 FROM appointments a
    WHERE a."staffId" = p_staff_id
      AND a."businessId" = p_business_id
      AND a.status::text NOT IN ('CANCELLED', 'NO_SHOW')
      AND a."startTime" < p_end_time
      AND a."endTime" > p_start_time
  ) THEN
    hold_id := NULL;
    staff_id := p_staff_id;
    start_time := p_start_time;
    end_time := p_end_time;
    expires_at := p_expires_at;
    conflict := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Check for overlapping active (unconsumed, unexpired) holds explicitly
  IF EXISTS (
    SELECT 1 FROM slot_holds h
    WHERE h.staff_id = p_staff_id
      AND h.business_id = p_business_id
      AND h.consumed_at IS NULL
      AND h.expires_at > NOW()
      AND h.start_time < p_end_time
      AND h.end_time > p_start_time
  ) THEN
    hold_id := NULL;
    staff_id := p_staff_id;
    start_time := p_start_time;
    end_time := p_end_time;
    expires_at := p_expires_at;
    conflict := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Insert hold; EXCLUDE constraint is the final safety net
  BEGIN
    INSERT INTO slot_holds (
      id, business_id, staff_id, customer_id, service_id,
      user_id, start_time, end_time, expires_at, created_at
    ) VALUES (
      gen_random_uuid()::TEXT, p_business_id, p_staff_id, p_customer_id,
      p_service_id, p_user_id, p_start_time, p_end_time, p_expires_at, NOW()
    )
    RETURNING
      slot_holds.id,
      slot_holds.staff_id,
      slot_holds.start_time,
      slot_holds.end_time,
      slot_holds.expires_at
    INTO hold_id, staff_id, start_time, end_time, expires_at;

    conflict := FALSE;
    RETURN NEXT;

  EXCEPTION WHEN exclusion_violation THEN
    hold_id := NULL;
    staff_id := p_staff_id;
    start_time := p_start_time;
    end_time := p_end_time;
    expires_at := p_expires_at;
    conflict := TRUE;
    RETURN NEXT;
  END;
END;
$$;
