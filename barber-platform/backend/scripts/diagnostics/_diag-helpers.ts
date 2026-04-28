export type TimingStats = {
  min: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  total: number;
  count: number;
};

export function nowMs(): number {
  return Number(process.hrtime.bigint() / BigInt(1_000_000));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function buildStats(values: number[]): TimingStats {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((acc, v) => acc + v, 0);
  return {
    min: sorted[0] ?? 0,
    avg: sorted.length ? total / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    total,
    count: sorted.length,
  };
}

export async function measureOne<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = nowMs();
  const result = await fn();
  return { ms: nowMs() - t0, result };
}

export function printSection(title: string, stats: TimingStats): void {
  console.log(
    JSON.stringify(
      {
        name: title,
        min: Number(stats.min.toFixed(2)),
        avg: Number(stats.avg.toFixed(2)),
        p50: Number(stats.p50.toFixed(2)),
        p95: Number(stats.p95.toFixed(2)),
        max: Number(stats.max.toFixed(2)),
        total: Number(stats.total.toFixed(2)),
        count: stats.count,
      },
      null,
      2,
    ),
  );
}
