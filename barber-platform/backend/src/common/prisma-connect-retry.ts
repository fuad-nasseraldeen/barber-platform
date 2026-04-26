/**
 * Staggered retries for Prisma $connect — reduces P1001 flaps during PM2 cluster boot / pool warm-up.
 */
export async function connectPrismaWithRetry(
  client: { $connect: () => Promise<void> },
  options?: { retries?: number; delayMs?: number },
): Promise<void> {
  const retries = options?.retries ?? 5;
  const delayMs = options?.delayMs ?? 2000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await client.$connect();
      console.log(`✅ Prisma connected (attempt ${attempt}/${retries})`);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `⚠️ Prisma connection failed (${attempt}/${retries}), retrying in ${delayMs}ms… ${msg}`,
      );
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw new Error(
    `❌ Could not connect to database after ${retries} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
