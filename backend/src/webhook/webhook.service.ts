import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { timingSafeEqual } from 'crypto';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';
import { IngestionService } from '../ingestion/ingestion.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private db: DatabaseService,
    private vectorstore: VectorstoreService,
    private ingestionService: IngestionService,
  ) {}

  /** Generate and store a webhook secret for a repo */
  setupWebhook(repoId: string): { webhookUrl: string; secret: string } {
    const repo = this.db
      .getDb()
      .prepare(`SELECT * FROM repos WHERE id=?`)
      .get(repoId) as any;
    if (!repo) throw new BadRequestException(`Repo ${repoId} not found`);

    const secret = randomBytes(32).toString('hex');
    this.db
      .getDb()
      .prepare(`UPDATE repos SET webhook_secret = ? WHERE id = ?`)
      .run(secret, repoId);

    return {
      webhookUrl: `/api/webhooks/github/${repoId}`,
      secret,
    };
  }

  /** Process a GitHub push webhook event */
  async handleGithubPush(
    repoId: string,
    signature: string | undefined,
    payload: any,
  ): Promise<{ status: string; changedFiles: string[] }> {
    const repo = this.db
      .getDb()
      .prepare(`SELECT * FROM repos WHERE id=?`)
      .get(repoId) as any;
    if (!repo) throw new BadRequestException(`Repo ${repoId} not found`);
    if (!repo.webhook_secret) {
      throw new BadRequestException('Webhook not configured for this repo');
    }

    // Validate signature
    if (!signature) {
      throw new ForbiddenException('Missing X-Hub-Signature-256 header');
    }
    const payloadStr =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expected = `sha256=${createHmac('sha256', repo.webhook_secret).update(payloadStr).digest('hex')}`;
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (
      sigBuf.length !== expectedBuf.length ||
      !timingSafeEqual(sigBuf, expectedBuf)
    ) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    // Parse changed files from push event
    const commits: any[] = payload.commits ?? [];
    const changedFiles = new Set<string>();
    for (const commit of commits) {
      for (const f of commit.added ?? []) changedFiles.add(f);
      for (const f of commit.modified ?? []) changedFiles.add(f);
      for (const f of commit.removed ?? []) changedFiles.add(f);
    }

    const filePaths = [...changedFiles];
    if (filePaths.length === 0) {
      return { status: 'no_changes', changedFiles: [] };
    }

    // Delete old embeddings for changed files
    await this.vectorstore.deleteByFilePaths(repoId, filePaths);

    // Trigger full re-ingestion (incremental would require more complex logic)
    // For now, we queue a re-ingestion job
    const token = undefined; // Use stored token if available
    await this.ingestionService.startIngestion(repo.url, repo.name, token);

    // Update last synced
    this.db
      .getDb()
      .prepare(`UPDATE repos SET last_synced_at = ? WHERE id = ?`)
      .run(Date.now(), repoId);

    this.logger.log(
      `Webhook received for repo ${repoId}: ${filePaths.length} files changed`,
    );

    return { status: 'reingestion_queued', changedFiles: filePaths };
  }
}
