#!/usr/bin/env ts-node
/**
 * Post-k6 DB invariant check — meant to run after any k6 scenario.
 *
 *   npm run test:booking:post-k6
 *
 * Only checks DB (no HTTP). Exits 1 on any error-level violation.
 */
import { loadBackendEnv } from '../lib/env';
import { createScriptPrisma } from '../lib/prisma-script';
import { runInvariantSuite } from '../invariants/suite';
import { printInvariantReport, exitFromResult } from '../lib/report';

loadBackendEnv();

async function main() {
  const businessId = (
    process.env.BUSINESS_ID ??
    process.env.TEST_BUSINESS_ID ??
    ''
  ).trim() || undefined;

  const prisma = createScriptPrisma();

  console.log(
    `\npost-k6 DB invariant check (businessId=${businessId?.slice(0, 8) ?? 'all'})`,
  );

  const result = await runInvariantSuite({
    prisma,
    businessId,
    skipAvailabilityHttp: true,
  });

  printInvariantReport(result);
  await prisma.$disconnect();
  exitFromResult(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
