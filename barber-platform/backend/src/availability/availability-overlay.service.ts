import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

type RedisHashAndZsetClient = {
  hgetall: (key: string) => Promise<Record<string, string>>;
  hset: (key: string, field: string, value: string) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  zadd: (key: string, ...args: string[]) => Promise<number>;
  zrangebyscore: (
    key: string,
    min: string,
    max: string,
    ...args: string[]
  ) => Promise<string[]>;
  zrem: (key: string, ...members: string[]) => Promise<number>;
};

export type AvailabilityOverlayEntry = {
  kind: 'hold' | 'booked';
  startMin: number;
  endMin: number;
  expiresAtMs?: number;
};

type ExpiredHoldCleanup = {
  businessId: string;
  staffId: string;
  dateYmd: string;
  holdId: string;
};

const OVERLAY_TTL_SEC = 2 * 24 * 60 * 60;

@Injectable()
export class AvailabilityOverlayService {
  constructor(private readonly redis: RedisService) {}

  private get client(): RedisHashAndZsetClient {
    return this.redis.getClient() as unknown as RedisHashAndZsetClient;
  }

  private overlayKey(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): string {
    return `av:overlay:${businessId}:${staffId}:${dateYmd.slice(0, 10)}`;
  }

  private expirationsKey(): string {
    return 'av:overlay:hold_expirations';
  }

  private holdField(holdId: string): string {
    return `h:${holdId}`;
  }

  private appointmentField(appointmentId: string): string {
    return `a:${appointmentId}`;
  }

  private holdMember(
    businessId: string,
    staffId: string,
    dateYmd: string,
    holdId: string,
  ): string {
    return [businessId, staffId, dateYmd.slice(0, 10), holdId].join('|');
  }

  async getDayEntries(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<AvailabilityOverlayEntry[]> {
    const key = this.overlayKey(businessId, staffId, dateYmd);
    const raw = await this.client.hgetall(key);
    if (!raw || Object.keys(raw).length === 0) return [];

    const nowMs = Date.now();
    const staleFields: string[] = [];
    const staleMembers: string[] = [];
    const out: AvailabilityOverlayEntry[] = [];

    for (const [field, value] of Object.entries(raw)) {
      try {
        const parsed = JSON.parse(value) as AvailabilityOverlayEntry;
        if (
          parsed.kind === 'hold' &&
          typeof parsed.expiresAtMs === 'number' &&
          parsed.expiresAtMs <= nowMs
        ) {
          staleFields.push(field);
          staleMembers.push(
            this.holdMember(
              businessId,
              staffId,
              dateYmd,
              field.slice(2),
            ),
          );
          continue;
        }
        out.push(parsed);
      } catch {
        staleFields.push(field);
      }
    }

    if (staleFields.length > 0) {
      await this.client.hdel(key, ...staleFields).catch(() => undefined);
    }
    if (staleMembers.length > 0) {
      await this.client
        .zrem(this.expirationsKey(), ...staleMembers)
        .catch(() => undefined);
    }

    return out;
  }

  async upsertHold(input: {
    businessId: string;
    staffId: string;
    dateYmd: string;
    holdId: string;
    startMin: number;
    endMin: number;
    expiresAtMs: number;
  }): Promise<void> {
    const key = this.overlayKey(input.businessId, input.staffId, input.dateYmd);
    await this.client.hset(
      key,
      this.holdField(input.holdId),
      JSON.stringify({
        kind: 'hold',
        startMin: input.startMin,
        endMin: input.endMin,
        expiresAtMs: input.expiresAtMs,
      } satisfies AvailabilityOverlayEntry),
    );
    await Promise.all([
      this.client.expire(key, OVERLAY_TTL_SEC),
      this.client.zadd(
        this.expirationsKey(),
        String(input.expiresAtMs),
        this.holdMember(
          input.businessId,
          input.staffId,
          input.dateYmd,
          input.holdId,
        ),
      ),
    ]);
  }

  async removeHold(input: {
    businessId: string;
    staffId: string;
    dateYmd: string;
    holdId: string;
  }): Promise<void> {
    await Promise.all([
      this.client.hdel(
        this.overlayKey(input.businessId, input.staffId, input.dateYmd),
        this.holdField(input.holdId),
      ),
      this.client.zrem(
        this.expirationsKey(),
        this.holdMember(
          input.businessId,
          input.staffId,
          input.dateYmd,
          input.holdId,
        ),
      ),
    ]);
  }

  async upsertBooked(input: {
    businessId: string;
    staffId: string;
    dateYmd: string;
    appointmentId: string;
    startMin: number;
    endMin: number;
  }): Promise<void> {
    const key = this.overlayKey(input.businessId, input.staffId, input.dateYmd);
    await this.client.hset(
      key,
      this.appointmentField(input.appointmentId),
      JSON.stringify({
        kind: 'booked',
        startMin: input.startMin,
        endMin: input.endMin,
      } satisfies AvailabilityOverlayEntry),
    );
    await this.client.expire(key, OVERLAY_TTL_SEC);
  }

  async removeBooked(input: {
    businessId: string;
    staffId: string;
    dateYmd: string;
    appointmentId: string;
  }): Promise<void> {
    await this.client.hdel(
      this.overlayKey(input.businessId, input.staffId, input.dateYmd),
      this.appointmentField(input.appointmentId),
    );
  }

  async cleanupExpiredHolds(limit = 200): Promise<ExpiredHoldCleanup[]> {
    const members = await this.client.zrangebyscore(
      this.expirationsKey(),
      '-inf',
      String(Date.now()),
      'LIMIT',
      '0',
      String(limit),
    );
    if (members.length === 0) return [];

    const affected: ExpiredHoldCleanup[] = [];
    for (const member of members) {
      const [businessId, staffId, dateYmd, holdId] = member.split('|');
      if (!businessId || !staffId || !dateYmd || !holdId) continue;

      await this.client.hdel(
        this.overlayKey(businessId, staffId, dateYmd),
        this.holdField(holdId),
      );
      affected.push({ businessId, staffId, dateYmd, holdId });
    }

    await this.client.zrem(this.expirationsKey(), ...members);
    return affected;
  }
}
