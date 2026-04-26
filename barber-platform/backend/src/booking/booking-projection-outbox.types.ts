export const BOOKING_PROJECTION_RESCHEDULE_EVENT_TYPE = 'RESCHEDULE_APPLIED' as const;

export type RescheduleAppliedOutboxPayload = {
  previous: {
    staffId: string;
    dateYmd: string;
    startMin: number;
    endMin: number;
  };
};

export function parseRescheduleAppliedOutboxPayload(
  value: unknown,
): RescheduleAppliedOutboxPayload | null {
  if (typeof value === 'string') {
    try {
      return parseRescheduleAppliedOutboxPayload(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (!rec.previous || typeof rec.previous !== 'object') return null;
  const prev = rec.previous as Record<string, unknown>;
  if (
    typeof prev.staffId !== 'string' ||
    typeof prev.dateYmd !== 'string' ||
    typeof prev.startMin !== 'number' ||
    typeof prev.endMin !== 'number'
  ) {
    return null;
  }
  return {
    previous: {
      staffId: prev.staffId,
      dateYmd: prev.dateYmd,
      startMin: prev.startMin,
      endMin: prev.endMin,
    },
  };
}
