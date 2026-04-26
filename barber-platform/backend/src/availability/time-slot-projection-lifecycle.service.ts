import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  addBusinessDaysFromYmd,
  businessLocalYmdFromJsDate,
  resolveScheduleWallClockZone,
} from '../common/business-local-time';
import { ensureValidBusinessZone } from '../common/time-engine';
import { isSchedulerPrimaryInstance } from '../common/scheduler-instance';
import { PrismaService } from '../prisma/prisma.service';
import { TimeSlotService } from './time-slot.service';
import { CacheService } from '../redis/cache.service';

type ProjectionTriggerModel =
  | 'Staff'
  | 'StaffWorkingHours'
  | 'StaffWorkingHoursDateOverride'
  | 'StaffBreak'
  | 'StaffBreakException'
  | 'StaffTimeOff'
  | 'StaffService'
  | 'Service'
  | 'BusinessHoliday'
  | 'Appointment'
  | 'SlotHold';

type ProjectionRunSummary = {
  businessId: string;
  staffId?: string;
  fromDate: string;
  toDate: string;
  generatedRows: number;
  deletedRows: number;
  durationMs: number;
  staffCount: number;
  triggerReason: string;
};

type RegenerateBusinessWindowInput = {
  businessId: string;
  staffId?: string;
  fromDate?: string;
  toDate?: string;
  reason?: string;
};

type PreloadContext = {
  rows: Record<string, unknown>[];
};

type ProjectionTarget = {
  businessId: string;
  staffId?: string;
  fromDate?: string;
  toDate?: string;
  triggerReason: string;
};

const PROJECTION_MODELS = new Set<string>([
  'Staff',
  'StaffWorkingHours',
  'StaffWorkingHoursDateOverride',
  'StaffBreak',
  'StaffBreakException',
  'StaffTimeOff',
  'StaffService',
  'Service',
  'BusinessHoliday',
  'Appointment',
  'SlotHold',
]);

const PROJECTION_WRITE_ACTIONS = new Set<string>([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
@Injectable()
export class TimeSlotProjectionLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(TimeSlotProjectionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeSlots: TimeSlotService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registerProjectionMutationMiddleware();
    await this.warnIfProjectionEmpty();
  }

  @Cron('15 0 * * *', { timeZone: 'UTC' })
  async ensureProjectionWindowDaily(): Promise<void> {
    if (!isSchedulerPrimaryInstance()) return;
    const businesses = await this.prisma.business.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    for (const business of businesses) {
      try {
        await this.regenerateBusinessWindow({
          businessId: business.id,
          reason: 'daily_window_maintenance',
        });
      } catch (error) {
        this.logger.warn(
          `time_slots daily maintenance failed for business=${business.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async regenerateBusinessWindow(
    input: RegenerateBusinessWindowInput,
  ): Promise<ProjectionRunSummary> {
    const t0 = Date.now();
    const reason = input.reason ?? 'manual_regeneration';
    const timezone = await this.getBusinessTimezone(input.businessId);
    const { fromDate, toDate } = this.resolveProjectionRange({
      timezone,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });

    const staffIds =
      input.staffId != null
        ? [input.staffId]
        : (
            await this.prisma.staff.findMany({
              where: {
                businessId: input.businessId,
                deletedAt: null,
                isActive: true,
              },
              select: { id: true },
            })
          ).map((s) => s.id);

    let generatedRows = 0;
    let deletedRows = 0;
    for (const staffId of staffIds) {
      const result = await this.regenerateStaffWindow({
        businessId: input.businessId,
        staffId,
        fromDate,
        toDate,
        timezone,
      });
      generatedRows += result.generatedRows;
      deletedRows += result.deletedRows;
    }

    const summary: ProjectionRunSummary = {
      businessId: input.businessId,
      staffId: input.staffId,
      fromDate,
      toDate,
      generatedRows,
      deletedRows,
      durationMs: Date.now() - t0,
      staffCount: staffIds.length,
      triggerReason: reason,
    };
    this.emitProjectionRunLog(summary);
    return summary;
  }

  private async regenerateStaffWindow(input: {
    businessId: string;
    staffId: string;
    fromDate: string;
    toDate: string;
    timezone: string;
  }): Promise<{ generatedRows: number; deletedRows: number }> {
    let generatedRows = 0;
    let deletedRows = 0;

    for (const ymd of this.eachDateInclusive(
      input.fromDate,
      input.toDate,
      input.timezone,
    )) {
      const day = await this.timeSlots.regenerateDay(
        input.businessId,
        input.staffId,
        ymd,
        input.timezone,
      );
      generatedRows += day.inserted;
      deletedRows += day.deletedRows;
      await this.invalidateProjectionCachesForDay(
        input.businessId,
        input.staffId,
        ymd,
      );
    }

    return { generatedRows, deletedRows };
  }

  private async invalidateProjectionCachesForDay(
    businessId: string,
    staffId: string,
    ymd: string,
  ): Promise<void> {
    await Promise.all([
      this.cache.invalidateAvailability(staffId, ymd),
      this.cache.del(CacheService.keys.availabilityHotDay(businessId, staffId, ymd)),
      this.cache.del(
        CacheService.keys.availabilityRescheduleDirtyDay(businessId, staffId, ymd),
      ),
      this.cache.del(
        CacheService.keys.availabilityRescheduleDirtyWindows(
          businessId,
          staffId,
          ymd,
        ),
      ),
    ]);
  }

  private registerProjectionMutationMiddleware(): void {
    this.prisma.$use(async (params, next) => {
      if (!this.isProjectionMutation(params)) {
        return next(params);
      }

      const context: PreloadContext = {
        rows: await this.preloadRowsBeforeMutation(params),
      };
      const result = await next(params);

      try {
        await this.triggerProjectionFromMutation(params, result, context);
      } catch (error) {
        this.logger.warn(
          `projection trigger failed for ${params.model}.${params.action}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return result;
    });
  }

  private async triggerProjectionFromMutation(
    params: Prisma.MiddlewareParams,
    result: unknown,
    context: PreloadContext,
  ): Promise<void> {
    const model = params.model as ProjectionTriggerModel;
    const triggerReason = this.resolveTriggerReason(model, params);
    const rows = this.resolveRowsForMutation(result, context, params.args?.data);

    const targets = await this.resolveTargetsForModel(model, rows, params, triggerReason);
    const merged = this.mergeTargets(targets);

    for (const target of merged) {
      await this.regenerateBusinessWindow({
        businessId: target.businessId,
        staffId: target.staffId,
        fromDate: target.fromDate,
        toDate: target.toDate,
        reason: target.triggerReason,
      });
    }
  }

  private async resolveTargetsForModel(
    model: ProjectionTriggerModel,
    rows: Record<string, unknown>[],
    params: Prisma.MiddlewareParams,
    triggerReason: string,
  ): Promise<ProjectionTarget[]> {
    if (model === 'BusinessHoliday') {
      return this.resolveHolidayTargets(rows, triggerReason);
    }

    if (model === 'Service') {
      const serviceIds = [...new Set(rows.map((r) => r.id).filter(Boolean) as string[])];
      const links = serviceIds.length
        ? await this.prisma.staffService.findMany({
            where: { serviceId: { in: serviceIds } },
            select: {
              staffId: true,
              staff: { select: { businessId: true } },
            },
          })
        : [];
      return links.map((link) => ({
        businessId: link.staff.businessId,
        staffId: link.staffId,
        triggerReason,
      }));
    }

    if (model === 'Staff') {
      return rows
        .filter((r) => typeof r.id === 'string' && typeof r.businessId === 'string')
        .map((r) => ({
          businessId: r.businessId as string,
          staffId: r.id as string,
          triggerReason,
        }));
    }

    const staffIds = [
      ...new Set(rows.map((r) => r.staffId).filter(Boolean) as string[]),
    ];
    if (staffIds.length === 0) return [];
    const staffRows = await this.prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, businessId: true },
    });
    const staffBizMap = new Map(staffRows.map((s) => [s.id, s.businessId]));
    const tzCache = new Map<string, string>();
    const out: ProjectionTarget[] = [];

    for (const row of rows) {
      const staffId = row.staffId as string | undefined;
      if (!staffId) continue;
      const businessId = staffBizMap.get(staffId);
      if (!businessId) continue;

      if (model === 'StaffWorkingHoursDateOverride' || model === 'StaffBreakException') {
        const date = row.date as Date | undefined;
        if (date instanceof Date) {
          const tz = await this.getBusinessTimezoneCached(businessId, tzCache);
          const ymd = businessLocalYmdFromJsDate(tz, date);
          out.push({
            businessId,
            staffId,
            fromDate: ymd,
            toDate: ymd,
            triggerReason,
          });
          continue;
        }
      }

      if (model === 'StaffTimeOff' || model === 'Appointment' || model === 'SlotHold') {
        const start = this.extractStartDateForRangeModel(model, row);
        const end = this.extractEndDateForRangeModel(model, row);
        if (start instanceof Date && end instanceof Date) {
          const tz = await this.getBusinessTimezoneCached(businessId, tzCache);
          const fromDate = businessLocalYmdFromJsDate(tz, start);
          const toDate = businessLocalYmdFromJsDate(tz, end);
          out.push({
            businessId,
            staffId,
            fromDate,
            toDate,
            triggerReason,
          });
          continue;
        }
      }

      out.push({ businessId, staffId, triggerReason });
    }

    if (params.action === 'updateMany' || params.action === 'deleteMany') {
      for (const s of staffRows) {
        out.push({ businessId: s.businessId, staffId: s.id, triggerReason });
      }
    }

    return out;
  }

  private async resolveHolidayTargets(
    rows: Record<string, unknown>[],
    triggerReason: string,
  ): Promise<ProjectionTarget[]> {
    const out: ProjectionTarget[] = [];
    const tzCache = new Map<string, string>();
    for (const row of rows) {
      const businessId = row.businessId as string | undefined;
      if (!businessId) continue;
      const isRecurring = row.isRecurring === true;
      const date = row.date as Date | undefined;
      if (isRecurring || !(date instanceof Date)) {
        out.push({ businessId, triggerReason });
        continue;
      }
      const tz = await this.getBusinessTimezoneCached(businessId, tzCache);
      const ymd = businessLocalYmdFromJsDate(tz, date);
      out.push({
        businessId,
        fromDate: ymd,
        toDate: ymd,
        triggerReason,
      });
    }
    return out;
  }

  private resolveTriggerReason(
    model: ProjectionTriggerModel,
    params: Prisma.MiddlewareParams,
  ): string {
    const data = (params.args?.data ?? {}) as Record<string, unknown>;

    if (model === 'StaffWorkingHours') return 'staff_working_hours_changed';
    if (model === 'StaffWorkingHoursDateOverride')
      return 'staff_working_hours_date_override_changed';
    if (model === 'StaffBreak') return 'staff_break_changed';
    if (model === 'StaffBreakException') return 'staff_break_exception_changed';
    if (model === 'StaffTimeOff') return 'staff_time_off_changed';
    if (model === 'BusinessHoliday') return 'business_holiday_changed';
    if (model === 'StaffService') return 'staff_service_changed';
    if (model === 'SlotHold') {
      if (params.action === 'create' || params.action === 'createMany') {
        return 'slot_hold_created';
      }
      if (params.action === 'delete' || params.action === 'deleteMany') {
        return 'slot_hold_cancelled';
      }
      if (Object.prototype.hasOwnProperty.call(data, 'consumedAt')) {
        return 'slot_hold_cancelled';
      }
      if (Object.prototype.hasOwnProperty.call(data, 'expiresAt')) {
        return 'slot_hold_expired';
      }
      return 'slot_hold_changed';
    }

    if (model === 'Service') {
      const durationChanged =
        Object.prototype.hasOwnProperty.call(data, 'durationMinutes') ||
        Object.prototype.hasOwnProperty.call(data, 'bufferBeforeMinutes') ||
        Object.prototype.hasOwnProperty.call(data, 'bufferAfterMinutes');
      return durationChanged ? 'service_duration_changed' : 'service_changed';
    }

    if (model === 'Staff') {
      const activationTouched = Object.prototype.hasOwnProperty.call(data, 'isActive');
      if (activationTouched) return 'staff_activation_changed';
      if (params.action === 'create' || params.action === 'createMany') return 'staff_created';
      if (params.action === 'delete' || params.action === 'deleteMany') return 'staff_deleted';
      return 'staff_changed';
    }

    if (model === 'Appointment') {
      if (params.action === 'create' || params.action === 'createMany') {
        return 'appointment_created';
      }
      if (params.action === 'delete' || params.action === 'deleteMany') {
        return 'appointment_cancelled';
      }
      if (data.status === 'CANCELLED') return 'appointment_cancelled';
      if (
        Object.prototype.hasOwnProperty.call(data, 'startTime') ||
        Object.prototype.hasOwnProperty.call(data, 'endTime') ||
        Object.prototype.hasOwnProperty.call(data, 'staffId')
      ) {
        return 'appointment_rescheduled';
      }
      return 'appointment_updated';
    }

    return `projection_changed:${model}`;
  }

  private resolveRowsForMutation(
    result: unknown,
    context: PreloadContext,
    data: unknown,
  ): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    if (Array.isArray(result)) {
      for (const row of result) {
        if (row && typeof row === 'object') out.push(row as Record<string, unknown>);
      }
    } else if (result && typeof result === 'object' && !('count' in (result as object))) {
      out.push(result as Record<string, unknown>);
    }
    out.push(...context.rows);
    out.push(...this.extractDataRows(data));
    return out;
  }

  private mergeTargets(targets: ProjectionTarget[]): ProjectionTarget[] {
    const map = new Map<string, ProjectionTarget>();
    for (const t of targets) {
      const key = `${t.businessId}:${t.staffId ?? '*'}:${t.triggerReason}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...t });
        continue;
      }
      const merged = { ...prev };
      if (!prev.fromDate || !prev.toDate || !t.fromDate || !t.toDate) {
        merged.fromDate = undefined;
        merged.toDate = undefined;
      } else {
        merged.fromDate = prev.fromDate < t.fromDate ? prev.fromDate : t.fromDate;
        merged.toDate = prev.toDate > t.toDate ? prev.toDate : t.toDate;
      }
      map.set(key, merged);
    }
    return [...map.values()];
  }

  private async preloadRowsBeforeMutation(
    params: Prisma.MiddlewareParams,
  ): Promise<Record<string, unknown>[]> {
    const model = params.model;
    if (!model) return [];
    const where = params.args?.where;
    if (!where || typeof where !== 'object') return [];
    if (!this.shouldPreloadRows(params.action)) return [];
    const delegate = this.getDelegate(this.prisma, model);
    const select = this.getSelectForModel(model as ProjectionTriggerModel);
    if (!delegate || !select || typeof delegate.findMany !== 'function') return [];
    try {
      const rows = await delegate.findMany({ where, select });
      return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }

  private shouldPreloadRows(action: string): boolean {
    return action === 'delete' || action === 'deleteMany' || action === 'updateMany';
  }

  private isProjectionMutation(params: Prisma.MiddlewareParams): boolean {
    return (
      params.model != null &&
      PROJECTION_MODELS.has(params.model) &&
      PROJECTION_WRITE_ACTIONS.has(params.action)
    );
  }

  private getDelegate(
    prisma: PrismaClient,
    model: string,
  ): Record<string, unknown> | null {
    const delegates: Record<string, string> = {
      Staff: 'staff',
      StaffWorkingHours: 'staffWorkingHours',
      StaffWorkingHoursDateOverride: 'staffWorkingHoursDateOverride',
      StaffBreak: 'staffBreak',
      StaffBreakException: 'staffBreakException',
      StaffTimeOff: 'staffTimeOff',
      StaffService: 'staffService',
      Service: 'service',
      BusinessHoliday: 'businessHoliday',
      Appointment: 'appointment',
      SlotHold: 'slotHold',
    };
    const key = delegates[model];
    if (!key) return null;
    return (prisma as unknown as Record<string, Record<string, unknown>>)[key] ?? null;
  }

  private getSelectForModel(
    model: ProjectionTriggerModel,
  ): Record<string, boolean> | null {
    switch (model) {
      case 'Staff':
        return { id: true, businessId: true };
      case 'StaffWorkingHours':
      case 'StaffBreak':
        return { id: true, staffId: true };
      case 'StaffWorkingHoursDateOverride':
      case 'StaffBreakException':
        return { id: true, staffId: true, date: true };
      case 'StaffTimeOff':
        return { id: true, staffId: true, startDate: true, endDate: true };
      case 'StaffService':
        return { id: true, staffId: true, serviceId: true, allowBooking: true };
      case 'Service':
        return {
          id: true,
          businessId: true,
          durationMinutes: true,
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
        };
      case 'BusinessHoliday':
        return { businessId: true, date: true, isRecurring: true };
      case 'Appointment':
      case 'SlotHold':
        return {
          id: true,
          businessId: true,
          staffId: true,
          startTime: true,
          endTime: true,
        };
      default:
        return null;
    }
  }

  private extractStartDateForRangeModel(
    model: ProjectionTriggerModel,
    row: Record<string, unknown>,
  ): Date | undefined {
    if (model === 'StaffTimeOff') {
      return row.startDate instanceof Date ? row.startDate : undefined;
    }
    if (model === 'Appointment' || model === 'SlotHold') {
      return row.startTime instanceof Date ? row.startTime : undefined;
    }
    return undefined;
  }

  private extractEndDateForRangeModel(
    model: ProjectionTriggerModel,
    row: Record<string, unknown>,
  ): Date | undefined {
    if (model === 'StaffTimeOff') {
      return row.endDate instanceof Date ? row.endDate : undefined;
    }
    if (model === 'Appointment' || model === 'SlotHold') {
      return row.endTime instanceof Date ? row.endTime : undefined;
    }
    return undefined;
  }

  private extractDataRows(data: unknown): Record<string, unknown>[] {
    if (!data) return [];
    if (Array.isArray(data)) {
      return data.filter((row) => row && typeof row === 'object') as Record<
        string,
        unknown
      >[];
    }
    if (typeof data === 'object') {
      return [data as Record<string, unknown>];
    }
    return [];
  }

  private getProjectionWindowDays(): number {
    const raw = this.config.get<string>('BOOKING_WINDOW_DAYS', '14');
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 14;
    return parsed;
  }

  private resolveProjectionRange(input: {
    timezone: string;
    fromDate?: string;
    toDate?: string;
  }): { fromDate: string; toDate: string } {
    const z = ensureValidBusinessZone(input.timezone);
    const today = DateTime.now().setZone(z).toISODate()!;
    const fromDate = (input.fromDate ?? today).slice(0, 10);
    const toDate =
      input.toDate?.slice(0, 10) ??
      addBusinessDaysFromYmd(z, fromDate, this.getProjectionWindowDays());
    if (toDate < fromDate) return { fromDate: toDate, toDate: fromDate };
    return { fromDate, toDate };
  }

  private *eachDateInclusive(
    fromDate: string,
    toDate: string,
    timezone: string,
  ): Generator<string> {
    let d = fromDate;
    while (d <= toDate) {
      yield d;
      d = addBusinessDaysFromYmd(timezone, d, 1);
    }
  }

  private async getBusinessTimezone(businessId: string): Promise<string> {
    const biz = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    return ensureValidBusinessZone(resolveScheduleWallClockZone(biz?.timezone));
  }

  private async getBusinessTimezoneCached(
    businessId: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const cached = cache.get(businessId);
    if (cached) return cached;
    const tz = await this.getBusinessTimezone(businessId);
    cache.set(businessId, tz);
    return tz;
  }

  private async warnIfProjectionEmpty(): Promise<void> {
    try {
      const businesses = await this.prisma.business.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, timezone: true },
      });
      for (const biz of businesses) {
        const tz = ensureValidBusinessZone(
          resolveScheduleWallClockZone(biz.timezone),
        );
        const todayBusinessYmd = DateTime.now().setZone(tz).toISODate()!;
        const count = await this.prisma.timeSlot.count({
          where: {
            businessId: biz.id,
            staff: { isActive: true, deletedAt: null },
            date: { gte: new Date(todayBusinessYmd) },
          },
        });
        if (count === 0) {
          this.logger.warn(`TIME_SLOTS_PROJECTION_EMPTY businessId=${biz.id}`);
        }
      }
    } catch (error) {
      this.logger.warn(
        `TIME_SLOTS_PROJECTION_EMPTY_CHECK_FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private emitProjectionRunLog(summary: ProjectionRunSummary): void {
    try {
      process.stdout.write(
        `${JSON.stringify({
          type: 'TIME_SLOT_PROJECTION_RUN',
          businessId: summary.businessId,
          staffId: summary.staffId ?? null,
          fromDate: summary.fromDate,
          toDate: summary.toDate,
          generatedRows: summary.generatedRows,
          deletedRows: summary.deletedRows,
          durationMs: summary.durationMs,
          staffCount: summary.staffCount,
          triggerReason: summary.triggerReason,
        })}\n`,
      );
    } catch {
      /* ignore */
    }
  }
}
