import { PrismaClient } from '@prisma/client';

/**
 * Low-connection-limit Prisma client for scripts (safe to run alongside the API).
 */
export function createScriptPrisma(databaseUrl?: string): PrismaClient {
  let url = databaseUrl ?? process.env.DATABASE_URL ?? '';
  const limit = Math.max(
    1,
    parseInt(process.env.SCRIPT_DB_CONNECTION_LIMIT || '2', 10) || 2,
  );
  if (/connection_limit=/i.test(url)) {
    url = url.replace(/connection_limit=\d+/i, `connection_limit=${limit}`);
  } else {
    const joiner = url.includes('?') ? '&' : '?';
    url = `${url}${joiner}connection_limit=${limit}&pool_timeout=20`;
  }

  return new PrismaClient({
    datasources: { db: { url } },
  });
}
