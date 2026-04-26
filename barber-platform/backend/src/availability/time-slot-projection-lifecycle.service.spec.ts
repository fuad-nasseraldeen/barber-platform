import { TimeSlotProjectionLifecycleService } from './time-slot-projection-lifecycle.service';

describe('TimeSlotProjectionLifecycleService', () => {
  function createService() {
    let middleware:
      | ((
          params: { model?: string; action: string; args?: Record<string, unknown> },
          next: (p: unknown) => Promise<unknown>,
        ) => Promise<unknown>)
      | undefined;

    const prisma = {
      $use: jest.fn((cb) => {
        middleware = cb;
      }),
      business: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Jerusalem' }),
      },
      staff: {
        findMany: jest.fn().mockResolvedValue([{ id: 's1', businessId: 'b1' }]),
      },
      timeSlot: {
        count: jest.fn().mockResolvedValue(1),
      },
    } as any;

    const timeSlots = {
      regenerateDay: jest
        .fn()
        .mockResolvedValue({ inserted: 3, preserved: 0, deletedRows: 1 }),
    } as any;

    const cache = {
      invalidateAvailability: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as any;

    const config = {
      get: jest.fn().mockReturnValue('14'),
    } as any;

    const service = new TimeSlotProjectionLifecycleService(
      prisma,
      timeSlots,
      cache,
      config,
    );

    return {
      service,
      prisma,
      timeSlots,
      cache,
      getMiddleware: () => middleware,
    };
  }

  it('regenerates a staff date range and returns generated/deleted totals', async () => {
    const { service, timeSlots, cache } = createService();

    const summary = await service.regenerateBusinessWindow({
      businessId: 'b1',
      staffId: 's1',
      fromDate: '2026-04-26',
      toDate: '2026-04-27',
      reason: 'test_manual',
    });

    expect(summary.businessId).toBe('b1');
    expect(summary.staffId).toBe('s1');
    expect(summary.generatedRows).toBe(6);
    expect(summary.deletedRows).toBe(2);
    expect(summary.staffCount).toBe(1);
    expect(summary.triggerReason).toBe('test_manual');
    expect(timeSlots.regenerateDay).toHaveBeenCalledTimes(2);
    expect(cache.invalidateAvailability).toHaveBeenCalledTimes(2);
    expect(cache.del).toHaveBeenCalledTimes(6);
  });

  it('triggers projection regeneration on staff working hours change', async () => {
    const { service, prisma, getMiddleware } = createService();
    const regenSpy = jest
      .spyOn(service, 'regenerateBusinessWindow')
      .mockResolvedValue({
        businessId: 'b1',
        staffId: 's1',
        fromDate: '2026-04-26',
        toDate: '2026-05-10',
        generatedRows: 0,
        deletedRows: 0,
        durationMs: 1,
        staffCount: 1,
        triggerReason: 'staff_working_hours_changed',
      });

    (service as any).registerProjectionMutationMiddleware();
    const middleware = getMiddleware();
    expect(middleware).toBeDefined();

    await middleware!(
      {
        model: 'StaffWorkingHours',
        action: 'update',
        args: { data: { startTime: '09:00' } },
      } as any,
      async () => ({ id: 'wh1', staffId: 's1' }),
    );

    expect(prisma.staff.findMany).toHaveBeenCalled();
    expect(regenSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        staffId: 's1',
        reason: 'staff_working_hours_changed',
      }),
    );
  });

  it('triggers projection regeneration on staff service assignment changes', async () => {
    const { service, getMiddleware } = createService();
    const regenSpy = jest
      .spyOn(service, 'regenerateBusinessWindow')
      .mockResolvedValue({
        businessId: 'b1',
        staffId: 's1',
        fromDate: '2026-04-26',
        toDate: '2026-05-10',
        generatedRows: 0,
        deletedRows: 0,
        durationMs: 1,
        staffCount: 1,
        triggerReason: 'staff_service_changed',
      });

    (service as any).registerProjectionMutationMiddleware();
    const middleware = getMiddleware();
    expect(middleware).toBeDefined();

    await middleware!(
      {
        model: 'StaffService',
        action: 'update',
        args: { data: { allowBooking: false } },
      } as any,
      async () => ({ id: 'ss1', staffId: 's1', serviceId: 'svc1' }),
    );

    expect(regenSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        staffId: 's1',
        reason: 'staff_service_changed',
      }),
    );
  });
});

