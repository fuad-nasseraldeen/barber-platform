import './load-env';
import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { QueuesModule } from './queues/queues.module';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { BranchesModule } from './branches/branches.module';
import { ServicesModule } from './services/services.module';
import { StaffModule } from './staff/staff.module';
import { BookingModule } from './booking/booking.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CustomerVisitsModule } from './customer-visits/customer-visits.module';
import { CustomersModule } from './customers/customers.module';
import { AutomationModule } from './automation/automation.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { RuntimeModule } from './common/runtime/runtime.module';
import { HttpConcurrencyMiddleware } from './common/runtime/http-concurrency.middleware';

/** Load tests: DISABLE_BOOKING_THROTTLE=1 removes ThrottlerModule + ThrottlerGuard entirely (no 429 from @nestjs/throttler). */
const THROTTLING_ENABLED = process.env.DISABLE_BOOKING_THROTTLE !== '1';

const throttlerImports = THROTTLING_ENABLED
  ? [
      ThrottlerModule.forRoot([
        {
          name: 'short',
          ttl: 1000,
          limit: 3,
        },
        {
          name: 'medium',
          ttl: 10000,
          limit: 20,
        },
        {
          name: 'long',
          ttl: 60000,
          limit: 100,
        },
      ]),
    ]
  : [];

const throttlerProviders = THROTTLING_ENABLED
  ? [
      {
        provide: APP_GUARD,
        useClass: ThrottlerGuard,
      },
    ]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ScheduleModule.forRoot(),
    ...throttlerImports,
    PrismaModule,
    RuntimeModule,
    RedisModule,
    HealthModule,
    QueuesModule,
    AuthModule,
    BusinessModule,
    BranchesModule,
    ServicesModule,
    StaffModule,
    BookingModule,
    WaitlistModule,
    PaymentsModule,
    NotificationsModule,
    AnalyticsModule,
    CustomerVisitsModule,
    CustomersModule,
    AutomationModule,
  ],
  providers: [
    ...throttlerProviders,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer
      .apply(HttpConcurrencyMiddleware)
      .exclude({ path: 'health(.*)', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
