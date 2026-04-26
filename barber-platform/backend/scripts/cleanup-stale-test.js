const { PrismaClient, AppointmentStatus } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const staffId = 'a0000001-0000-4000-8000-000000000003';

  const appts = await p.appointment.findMany({
    where: {
      staffId,
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
      startTime: { gte: new Date('2026-04-10T00:00:00Z'), lt: new Date('2026-04-11T00:00:00Z') },
    },
    select: { id: true, status: true, startTime: true, endTime: true },
  });
  console.log('active appointments:', JSON.stringify(appts, null, 2));

  const holds = await p.slotHold.findMany({
    where: {
      staffId,
      consumedAt: null,
      startTime: { lt: new Date('2026-04-11T00:00:00Z') },
      endTime: { gt: new Date('2026-04-10T00:00:00Z') },
    },
    select: { id: true, startTime: true, endTime: true, expiresAt: true },
  });
  console.log('active unconsumed holds:', JSON.stringify(holds, null, 2));

  const r = await p.appointment.updateMany({
    where: {
      staffId,
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW, AppointmentStatus.COMPLETED] },
      startTime: { gte: new Date('2026-04-10T00:00:00Z'), lt: new Date('2026-04-11T00:00:00Z') },
    },
    data: { status: AppointmentStatus.CANCELLED },
  });
  console.log('cancelled:', r.count);

  const ts = await p.$executeRawUnsafe(
    `UPDATE time_slots SET status='free', appointment_id=NULL, hold_id=NULL, updated_at=now() WHERE staff_id=$1 AND date='2026-04-10' AND status IN ('booked','held')`,
    staffId,
  );
  console.log('freed time_slots:', ts);

  const sh = await p.$executeRawUnsafe(
    `DELETE FROM slot_holds WHERE staff_id=$1 AND consumed_at IS NULL`,
    staffId,
  );
  console.log('deleted unconsumed holds:', sh);

  await p.$disconnect();
})();
