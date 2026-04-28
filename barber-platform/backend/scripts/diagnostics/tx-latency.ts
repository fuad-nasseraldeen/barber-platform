import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildStats, measureOne, printSection } from './_diag-helpers';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
class DiagTxLatencyModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(DiagTxLatencyModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);

    const emptyTx: number[] = [];
    const txSelect1: number[] = [];
    const tx3Selects: number[] = [];
    const tx10Selects: number[] = [];

    for (let i = 0; i < 20; i++) {
      emptyTx.push((await measureOne(() => prisma.$transaction(async () => undefined))).ms);
      txSelect1.push(
        (
          await measureOne(() =>
            prisma.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT 1`;
            }),
          )
        ).ms,
      );
      tx3Selects.push(
        (
          await measureOne(() =>
            prisma.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT 1`;
              await tx.$queryRaw`SELECT 1`;
              await tx.$queryRaw`SELECT 1`;
            }),
          )
        ).ms,
      );
      tx10Selects.push(
        (
          await measureOne(() =>
            prisma.$transaction(async (tx) => {
              for (let q = 0; q < 10; q++) {
                await tx.$queryRaw`SELECT 1`;
              }
            }),
          )
        ).ms,
      );
    }

    console.log(JSON.stringify({ type: 'DIAG_TX_LATENCY' }, null, 2));
    printSection('empty transaction x20', buildStats(emptyTx));
    printSection('transaction + SELECT 1 x20', buildStats(txSelect1));
    printSection('transaction + 3 SELECTs x20', buildStats(tx3Selects));
    printSection('transaction + 10 SELECTs x20', buildStats(tx10Selects));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
