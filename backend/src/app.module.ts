import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SharedModule } from './shared/shared.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { QueryModule } from './query/query.module';
import { ReposModule } from './repos/repos.module';
import { HistoryModule } from './history/history.module';
import { ArchDocModule } from './archdoc/archdoc.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrAnalysisModule } from './pr-analysis/pr-analysis.module';
import { HealthModule } from './health/health.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // BullMQ with Redis (optional - falls back to in-memory if Redis unavailable)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: parseInt(configService.get('REDIS_PORT', '63791')),
          retryDelayOnFailover: 500,
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          // Gracefully handle Redis connection failures
          connectTimeout: 5000,
          commandTimeout: 5000,
        },
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 20,
        },
      }),
    }),
    SharedModule,
    IngestionModule,
    QueryModule,
    ReposModule,
    HistoryModule,
    ArchDocModule,
    OnboardingModule,
    PrAnalysisModule,
    HealthModule,
    WebhookModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
