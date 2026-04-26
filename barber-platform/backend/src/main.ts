import './load-env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

const ts = () => new Date().toISOString();

process.on('uncaughtException', (err) => {
  console.error(`[${ts()}] FATAL uncaughtException pid=${process.pid}`, err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(
    `[${ts()}] unhandledRejection pid=${process.pid}`,
    reason,
    promise,
  );
});
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as compression from 'compression';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { enableRedis } from './common/redis-config';

// CJS module — default import breaks in dist without esModuleInterop (PM2: "default is not a function").
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');

async function bootstrap() {
  console.log(`🚀 Instance ${process.pid} starting…`);
  console.log('DISABLE_BOOKING_THROTTLE:', process.env.DISABLE_BOOKING_THROTTLE);
  if (!enableRedis) {
    console.log('Redis disabled (development mode)');
  }
  // Prisma $connect runs in PrismaService.onModuleInit with retries (5×, 2s) during create()
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.enableShutdownHooks();

  /** If a client timeout or middleware sends a response first, Nest must not throw on second res.json. */
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = function guardedJson(body?: unknown) {
      if (res.headersSent || res.writableEnded) {
        return res;
      }
      return origJson(body);
    };
    const origSend = res.send.bind(res);
    res.send = function guardedSend(body?: unknown) {
      if (res.headersSent || res.writableEnded) {
        return res;
      }
      return origSend(body as never);
    };
    next();
  });

  if (process.env.AVAILABILITY_EMPTY_DEBUG === '1') {
    expressApp.use((req, res, next) => {
      const path = (req.path || req.url || '').toString();
      const isAvailabilityGet =
        req.method === 'GET' &&
        (path.endsWith('/availability') || path.includes('/availability?'));
      if (!isAvailabilityGet) {
        return next();
      }

      const q = req.query as Record<string, unknown>;
      const startedAt = Date.now();
      const inPayload = {
        type: 'AVAILABILITY_DEBUG_HTTP_IN',
        method: req.method,
        path: req.originalUrl || req.url,
        query: {
          businessId: q.businessId ?? null,
          staffId: q.staffId ?? null,
          serviceId: q.serviceId ?? null,
          date: q.date ?? null,
          days: q.days ?? null,
          chronologicalSlots: q.chronologicalSlots ?? null,
          compact: q.compact ?? null,
        },
        hasAuthorizationHeader: Boolean(req.headers.authorization),
      };
      console.log(JSON.stringify(inPayload));

      res.on('finish', () => {
        console.log(
          JSON.stringify({
            type: 'AVAILABILITY_DEBUG_HTTP_OUT',
            method: req.method,
            path: req.originalUrl || req.url,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
          }),
        );
      });
      next();
    });
  }

  app.use(compression());
  app.use(cookieParser());
  const uploadsDir = join(process.cwd(), 'uploads', 'staff');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  const prefix = process.env.API_PREFIX || 'api/v1';
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) || [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Keep false: implicit boolean coercion uses Boolean(string) and breaks query flags like compact=0
      // (Boolean("0") === true). DTOs must use @Type / explicit @Transform for numbers and booleans.
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  const port = process.env.PORT || 3000;
  await app.listen(port);

  const httpServer = app.getHttpServer();
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;

  const shutdown = async (signal: string) => {
    console.log(`[${ts()}] ${signal} received — graceful shutdown pid=${process.pid}`);
    try {
      await app.close();
    } catch (e) {
      console.error('app.close failed', e);
    }
    process.exit(0);
  };
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  console.log(`✅ App ready — http://localhost:${port}/${prefix}`);
}

bootstrap().catch((e) => {
  console.error(`[${ts()}] bootstrap failed pid=${process.pid}`, e);
  process.exit(1);
});
