#!/usr/bin/env ts-node
/**
 * Standalone invariant checker — run after any test or ad-hoc.
 *
 *   npm run test:booking:invariants
 *   npm run test:booking:invariants -- --businessId=<uuid>
 *
 * Env: DATABASE_URL (required), BUSINESS_ID, AUTH_TOKEN, BASE_URL (optional for HTTP check).
 */
import { loadBackendEnv, intEnv } from '../lib/env';
import { createScriptPrisma } from '../lib/prisma-script';
import { runInvariantSuite } from '../invariants/suite';
import { printInvariantReport, exitFromResult } from '../lib/report';
import {
  resolveFixture,
  blockMinutesFor,
  findDateWithSlots,
} from '../lib/booking-api';

loadBackendEnv();

function argBusinessId(): string | undefined {
  const a = process.argv.find((x) => x.startsWith('--businessId='));
  return a ? a.slice('--businessId='.length).trim() || undefined : undefined;
}

async function main() {
  const businessId =
    argBusinessId() ??
    process.env.BUSINESS_ID ??
    process.env.TEST_BUSINESS_ID ??
    undefined;
  const authToken = (
    process.env.AUTH_TOKEN ??
    process.env.K6_AUTH_TOKEN ??
    ''
  )
    .trim()
    .replace(/^Bearer\s+/i, '');
  const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').trim();
  const apiPrefix = (process.env.API_PREFIX || 'api/v1').trim();
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL required');

  const prisma = createScriptPrisma(databaseUrl);
  const canHttp = !!authToken && !!businessId;

  let httpOpts:
    | {
        baseUrl: string;
        apiPrefix: string;
        authToken: string;
        staffId: string;
        serviceId: string;
        dateYmd: string;
        blockMinutes: number;
        businessTimezone: string;
      }
    | undefined;

  if (canHttp) {
    try {
      const apiOpts = { baseUrl, apiPrefix, authToken };
      const fx = await resolveFixture(apiOpts, businessId);
      const serviceId = fx.serviceIds[0];
      const block = blockMinutesFor(fx, fx.staffId, serviceId);
      const dateResult = await findDateWithSlots(
        apiOpts,
        businessId,
        fx.staffId,
        serviceId,
        1,
      );
      if (dateResult) {
        httpOpts = {
          baseUrl,
          apiPrefix,
          authToken,
          staffId: fx.staffId,
          serviceId,
          dateYmd: dateResult.dateYmd,
          blockMinutes: block,
          businessTimezone: fx.businessTimezone,
        };
      }
    } catch (e) {
      console.warn(
        `HTTP availability check skipped: ${(e as Error).message}`,
      );
    }
  }

  console.log(
    `Running invariant suite (businessId=${businessId?.slice(0, 8) ?? 'all'}` +
      `, httpCheck=${!!httpOpts})`,
  );

  const result = await runInvariantSuite({
    prisma,
    businessId,
    skipAvailabilityHttp: !httpOpts,
    httpOpts,
  });

  printInvariantReport(result);
  await prisma.$disconnect();
  exitFromResult(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
