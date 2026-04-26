import { Injectable } from '@nestjs/common';

/** In-memory concurrent HTTP request counter (single Node process). */
@Injectable()
export class HttpConcurrencyTracker {
  private inFlight = 0;

  enter(): void {
    this.inFlight++;
  }

  leave(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  getInFlight(): number {
    return this.inFlight;
  }
}
