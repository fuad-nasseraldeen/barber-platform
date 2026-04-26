import { Global, Module } from '@nestjs/common';
import { HttpConcurrencyMiddleware } from './http-concurrency.middleware';
import { HttpConcurrencyTracker } from './http-concurrency.tracker';
import { RuntimeDiagnosticsService } from './runtime-diagnostics.service';

@Global()
@Module({
  providers: [
    HttpConcurrencyTracker,
    HttpConcurrencyMiddleware,
    RuntimeDiagnosticsService,
  ],
  exports: [
    HttpConcurrencyTracker,
    HttpConcurrencyMiddleware,
    RuntimeDiagnosticsService,
  ],
})
export class RuntimeModule {}
