import { PrismaClient } from '@prisma/client';
import { BENCHMARK_FIXTURE, resetBenchmarkFixture } from './benchmark-fixture-lib';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(
    async (tx) => {
      await resetBenchmarkFixture(tx);
    },
    { maxWait: 60_000, timeout: 300_000 },
  );

  console.log(
    JSON.stringify({
      action: 'reset',
      businessId: BENCHMARK_FIXTURE.businessId,
      ownerEmail: BENCHMARK_FIXTURE.ownerEmail,
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
