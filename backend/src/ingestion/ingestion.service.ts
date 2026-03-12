import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../shared/database.service';
import { INGESTION_QUEUE_NAME, IngestionJobData } from './ingestion.queue';

export interface IngestionJob {
  jobId: string;
  repoId: string;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'waiting';
  progress: number;
  totalFiles: number;
  processedFiles: number;
  phase?: string;
  error?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectQueue(INGESTION_QUEUE_NAME)
    private ingestionQueue: Queue<IngestionJobData>,
    private db: DatabaseService,
  ) {}

  async startIngestion(
    url: string,
    name?: string,
    token?: string,
  ): Promise<{ jobId: string; repoId: string }> {
    const repoId = randomUUID();
    const jobId = randomUUID();
    const repoName = name || this.extractRepoName(url);
    const now = Date.now();

    // Persist repo record
    this.db
      .getDb()
      .prepare(
        `
      INSERT INTO repos (id, url, name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `,
      )
      .run(repoId, url, repoName, now, now);

    // Add job to queue
    await this.ingestionQueue.add(
      'ingest-repo',
      { repoId, url, token },
      {
        jobId, // Set custom job ID
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    );

    this.logger.log(
      `Queued ingestion job ${jobId} for repo ${repoName} (${url})`,
    );

    return { jobId, repoId };
  }

  async getJobStatus(jobId: string): Promise<IngestionJob> {
    try {
      const job = await this.ingestionQueue.getJob(jobId);

      if (!job) {
        // Fall back to DB for completed/failed jobs
        const row = this.db
          .getDb()
          .prepare('SELECT * FROM jobs WHERE id = ?')
          .get(jobId) as any;

        if (!row) {
          throw new NotFoundException(`Job ${jobId} not found`);
        }

        return {
          jobId: row.id,
          repoId: row.repo_id,
          status: row.status,
          progress: row.progress || 0,
          totalFiles: row.total_files || 0,
          processedFiles: row.processed_files || 0,
          phase: row.phase,
          error: row.error,
        };
      }

      const progress = (job.progress as any) || {
        filesProcessed: 0,
        totalFiles: 0,
        phase: 'queued',
      };

      return {
        jobId: job.id || jobId,
        repoId: job.data.repoId,
        status: (await job.getState()) as any,
        progress:
          progress.totalFiles > 0
            ? Math.floor((progress.filesProcessed / progress.totalFiles) * 100)
            : 0,
        totalFiles: progress.totalFiles,
        processedFiles: progress.filesProcessed,
        phase: progress.phase,
        error: job.failedReason,
      };
    } catch (error) {
      this.logger.error(`Error getting job status for ${jobId}:`, error);
      throw new NotFoundException(`Job ${jobId} not found or error occurred`);
    }
  }

  private extractRepoName(url: string): string {
    const parts = url.replace(/\.git$/, '').split('/');
    return parts[parts.length - 1] || 'unknown';
  }
}
