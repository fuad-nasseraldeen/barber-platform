import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { connectPrismaWithRetry } from '../common/prisma-connect-retry';
import {
  addPrismaMiddlewareQueryRecord,
  addPrismaQueryEventRecord,
  addPrismaQueryDuration,
  getLogContext,
  getRequestEndpoint,
  getRequestId,
} from '../common/request-context';

const prismaLog = new Logger('PrismaQuery');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const logQueries = process.env.PRISMA_LOG_QUERIES === '1';
    super({
      log: logQueries
        ? [
            { level: 'query', emit: 'event' },
            { level: 'error', emit: 'stdout' },
          ]
        : [
            { level: 'warn', emit: 'stdout' },
            { level: 'error', emit: 'stdout' },
          ],
    });

    if (logQueries) {
      // Valid when `log` includes `{ level: 'query', emit: 'event' }`; subclass + conditional `super()` loses inference.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma generated $on(event) union
      (this as any).$on('query', (e: Prisma.QueryEvent) => {
        const sql = e.query.replace(/\s+/g, ' ').trim();
        addPrismaQueryEventRecord({
          durationMs: e.duration,
          target: e.target,
          sql: sql.length > 2000 ? `${sql.slice(0, 2000)}…` : sql,
          params: e.params.length > 1000 ? `${e.params.slice(0, 1000)}…` : e.params,
        });
        prismaLog.log(
          JSON.stringify({
            ...getLogContext(),
            requestId: getRequestId(),
            prismaDurationMs: e.duration,
            prismaTarget: e.target,
            query: sql.length > 500 ? `${sql.slice(0, 500)}…` : sql,
            params: e.params.length > 300 ? `${e.params.slice(0, 300)}…` : e.params,
          }),
        );
      });
    }
  }

  async onModuleInit() {
    await connectPrismaWithRetry(this, { retries: 5, delayMs: 2000 });
    /** Always accumulate wall time in RequestContext (BookingPerfInterceptor + diagnostics). */
    this.$use(async (params, next) => {
      const t0 = Date.now();
      try {
        return await next(params);
      } finally {
        const dt = Date.now() - t0;
        addPrismaQueryDuration(dt);
        addPrismaMiddlewareQueryRecord(params.model, params.action, dt);
        if (dt > 100 && getRequestEndpoint() === 'availability') {
          const queryType = params.model
            ? `${params.model}.${params.action}`
            : 'raw';
          prismaLog.warn(
            JSON.stringify({
              ...getLogContext(),
              requestId: getRequestId(),
              endpoint: 'availability',
              type: queryType,
              action: params.action,
              durationMs: dt,
            }),
          );
        }
      }
    });
    const url = process.env.DATABASE_URL || '';
    const m = url.match(/connection_limit=(\d+)/i);
    if (m) {
      prismaLog.log(`Prisma pool connection_limit=${m[1]} (raise only if DB/pooler allows; under load P2024 = pool starvation)`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
