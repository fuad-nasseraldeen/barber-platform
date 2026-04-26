/**
 * בדיקה: schedule-snapshot קורא ל-computed פעם אחת לכל שירות ומחזיר מבנה תקין.
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StaffService } from './staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { ComputedAvailabilityService } from '../availability/computed-availability.service';
import { addBusinessDaysFromYmd, resolveBusinessTimeZone } from '../common/business-local-time';

describe('StaffService.getScheduleSnapshot', () => {
  it('קורא getAvailabilityDayMap ומחזיר perDay לכל יום בטווח', async () => {
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
      },
      staff: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'staff-1',
            firstName: 'Test',
            lastName: 'User',
            email: null,
            phone: null,
            branch: { id: 'b1', name: 'Main' },
            isActive: true,
            staffWorkingHours: [
              { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
            ],
            staffBreaks: [],
            staffBreakExceptions: [],
            staffTimeOff: [],
            staffServices: [
              {
                service: { id: 'svc-1', name: 'Haircut' },
              },
            ],
          },
        ]),
      },
    };
    const computed = {
      getAvailabilityDayMap: jest
        .fn()
        .mockImplementation(async (_biz, _sid, _svc, anchorYmd) => {
          const m = new Map();
          const tz = resolveBusinessTimeZone('UTC');
          for (let i = 0; i < 5; i++) {
            m.set(addBusinessDaysFromYmd(tz, anchorYmd, i), { slots: [`${9 + i}:00`] });
          }
          return m;
        }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: CacheService, useValue: {} },
        { provide: ComputedAvailabilityService, useValue: computed },
      ],
    }).compile();

    const svc = mod.get(StaffService);
    const out = await svc.getScheduleSnapshot('biz-1', undefined, false);

    expect(out.staff).toHaveLength(1);
    expect(out.staff[0].servicesAvailability[0].perDay).toHaveLength(5);
    expect(out.staff[0].servicesAvailability[0].totalSlotOptions).toBe(5);
    expect(computed.getAvailabilityDayMap).toHaveBeenCalledTimes(1);
    console.log('[jest staff snapshot]', out.staff[0].summary);
  });
});
