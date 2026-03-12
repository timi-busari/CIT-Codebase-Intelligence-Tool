import { BullModule } from '@nestjs/bullmq';

export const INGESTION_QUEUE_NAME = 'ingestion-queue';

export const IngestionQueueModule = BullModule.registerQueue({
  name: INGESTION_QUEUE_NAME,
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '63791'),
    // Gracefully handle Redis connection failures
    retryDelayOnFailover: 500,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 20,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export interface IngestionJobData {
  repoId: string;
  url: string;
  token?: string;
}

export interface IngestionJobProgress {
  phase: 'cloning' | 'filtering' | 'chunking' | 'embedding' | 'complete';
  filesProcessed: number;
  totalFiles: number;
  currentFile?: string;
}
