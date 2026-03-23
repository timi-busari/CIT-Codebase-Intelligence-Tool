import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';

const EMBEDDING_TTL = 60 * 60 * 24 * 7; // 7 days
const QUERY_TTL = 60 * 60; // 1 hour

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private enabled = false;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('REDIS_HOST', 'localhost');
    const port = parseInt(this.config.get<string>('REDIS_PORT', '63791'));

    try {
      this.redis = new Redis({
        host,
        port,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) =>
          times > 2 ? null : Math.min(times * 500, 2000),
      });

      this.redis.on('connect', () => {
        this.enabled = true;
        this.logger.log('Redis cache connected');
      });
      this.redis.on('error', () => {
        this.enabled = false;
      });

      this.redis.connect().catch(() => {
        this.logger.warn('Redis cache unavailable — caching disabled');
        this.enabled = false;
      });
    } catch {
      this.logger.warn('Could not create Redis client — caching disabled');
    }
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── Embedding cache ─────────────────────────────────────────────────────
  private embeddingKey(text: string, model: string): string {
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 24);
    return `emb:${model}:${hash}`;
  }

  async getCachedEmbedding(
    text: string,
    model: string,
  ): Promise<number[] | null> {
    if (!this.enabled || !this.redis) return null;
    try {
      const raw = await this.redis.getBuffer(this.embeddingKey(text, model));
      if (!raw) return null;
      // Stored as Float32Array buffer for compactness
      const floats = new Float32Array(
        raw.buffer,
        raw.byteOffset,
        raw.byteLength / 4,
      );
      return Array.from(floats);
    } catch {
      return null;
    }
  }

  async setCachedEmbedding(
    text: string,
    model: string,
    vector: number[],
  ): Promise<void> {
    if (!this.enabled || !this.redis) return;
    try {
      const buf = Buffer.from(new Float32Array(vector).buffer);
      await this.redis.set(
        this.embeddingKey(text, model),
        buf,
        'EX',
        EMBEDDING_TTL,
      );
    } catch {
      // Cache write failure is non-critical
    }
  }

  // ── Query result cache ──────────────────────────────────────────────────
  private queryKey(question: string, repoIds: string[]): string {
    const payload = JSON.stringify({ q: question, r: repoIds.sort() });
    const hash = createHash('sha256')
      .update(payload)
      .digest('hex')
      .slice(0, 24);
    return `qry:${hash}`;
  }

  async getCachedQuery(
    question: string,
    repoIds: string[],
  ): Promise<string | null> {
    if (!this.enabled || !this.redis) return null;
    try {
      return await this.redis.get(this.queryKey(question, repoIds));
    } catch {
      return null;
    }
  }

  async setCachedQuery(
    question: string,
    repoIds: string[],
    answer: string,
  ): Promise<void> {
    if (!this.enabled || !this.redis) return;
    try {
      await this.redis.set(
        this.queryKey(question, repoIds),
        answer,
        'EX',
        QUERY_TTL,
      );
    } catch {
      // Cache write failure is non-critical
    }
  }

  // ── Cache invalidation ─────────────────────────────────────────────────
  async invalidateRepo(_repoId: string): Promise<void> {
    if (!this.enabled || !this.redis) return;
    try {
      // Invalidate all query caches (they may reference this repo's data)
      const keys = await this.redis.keys('qry:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch {
      // Non-critical
    }
  }
}
