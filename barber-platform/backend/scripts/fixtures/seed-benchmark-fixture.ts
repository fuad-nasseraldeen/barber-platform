import { PrismaClient } from '@prisma/client';
import {
  BENCHMARK_FIXTURE,
  reseedBenchmarkFixture,
} from './benchmark-fixture-lib';

const prisma = new PrismaClient();

async function main() {
  await reseedBenchmarkFixture(prisma);

  console.log(
    JSON.stringify({
      action: 'reseed',
      businessId: BENCHMARK_FIXTURE.businessId,
      branchId: BENCHMARK_FIXTURE.branchId,
      ownerEmail: BENCHMARK_FIXTURE.ownerEmail,
      staffIds: BENCHMARK_FIXTURE.staff.map((s) => s.id),
      serviceIds: BENCHMARK_FIXTURE.services.map((s) => s.id),
      customerIds: BENCHMARK_FIXTURE.customers.map((c) => c.id),
      appointmentIds: BENCHMARK_FIXTURE.appointments.map((a) => a.id),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
