import { Injectable } from '@nestjs/common';

type LabelAgg = { count: number; msTotal: number };

const globalByLabel = new Map<string, LabelAgg>();

/**
 * Aggregates Redis SCAN/UNLINK cost for `delPattern` calls (e.g. availability bust on hold/book).
 * Exposed via GET /appointments/metrics for bottleneck analysis.
 */
@Injectable()
export class CacheBustMetricsService {
  recordDelPattern(label: string, ms: number): void {
    const prev = globalByLabel.get(label) ?? { count: 0, msTotal: 0 };
    prev.count += 1;
    prev.msTotal += Math.max(0, ms);
    globalByLabel.set(label, prev);
  }

  getSnapshot(): Record<
    string,
    { count: number; msTotal: number; avgMs: number }
  > {
    const out: Record<string, { count: number; msTotal: number; avgMs: number }> =
      {};
    for (const [label, v] of globalByLabel) {
      out[label] = {
        count: v.count,
        msTotal: Math.round(v.msTotal),
        avgMs: v.count > 0 ? Math.round(v.msTotal / v.count) : 0,
      };
    }
    return out;
  }
}
