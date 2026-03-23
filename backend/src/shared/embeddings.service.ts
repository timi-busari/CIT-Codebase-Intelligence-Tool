import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CacheService } from './cache.service';

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private client: OpenAI;
  private model: string;
  private provider: 'openai' | 'ollama';
  private ready = false;
  private dimension: number | null = null;

  constructor(
    private config: ConfigService,
    private cache: CacheService,
  ) {}

  onModuleInit() {
    const useOllama =
      this.config.get<string>('ENABLE_OLLAMA', 'false') === 'true';

    if (useOllama) {
      const baseURL = this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      );
      this.model = this.config.get<string>(
        'OLLAMA_EMBEDDING_MODEL',
        'mxbai-embed-large',
      );
      this.provider = 'ollama';
      this.client = new OpenAI({
        baseURL: `${baseURL.replace(/\/$/, '')}/v1`,
        apiKey: 'ollama',
      });
    } else {
      this.model = this.config.get<string>(
        'OPENAI_EMBEDDING_MODEL',
        'text-embedding-3-small',
      );
      this.provider = 'openai';
      this.client = new OpenAI({
        apiKey: this.config.get<string>('OPENAI_API_KEY', ''),
      });
    }

    this.ready = true;
    this.logger.log(
      `Embedding provider: ${this.provider}  model=${this.model}`,
    );
  }

  /** Truncate text to stay within embedding model context limits */
  private truncateForEmbedding(text: string): string {
    if (!text) return '';
    // mxbai-embed-large: 512 tokens. BERT tokenizer on code averages ~3 chars/token.
    // 512 * 3 = 1536, but special chars/imports tokenize worse → use 1000 as safe limit.
    const maxChars = this.model.includes('mxbai') ? 1000 : 4000;
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars);
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ready) throw new Error('Embedding service not initialized');

    // Check cache first
    const cached = await this.cache.getCachedEmbedding(text, this.model);
    if (cached) return cached;

    const safeText = this.truncateForEmbedding(text);
    const response = await this.client.embeddings.create({
      model: this.model,
      input: safeText,
    });
    const vector = response.data[0].embedding;

    // Store in cache (fire-and-forget)
    this.cache.setCachedEmbedding(text, this.model, vector);

    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.ready) throw new Error('Embedding service not initialized');
    if (texts.length === 0) return [];

    // OpenAI supports large batches; Ollama works with moderate batches
    const batchSize = this.provider === 'openai' ? 100 : 10;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // Safety check: truncate any texts that are still too long
      const safeBatch = batch.map((text) => this.truncateForEmbedding(text));

      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: safeBatch,
        });
        results.push(...response.data.map((d) => d.embedding));
      } catch (error) {
        this.logger.warn(
          `Batch of ${safeBatch.length} failed, falling back to individual embedding. Error: ${error.message}`,
        );
        // Fallback: embed each text individually
        for (let j = 0; j < safeBatch.length; j++) {
          try {
            const resp = await this.client.embeddings.create({
              model: this.model,
              input: safeBatch[j],
            });
            results.push(resp.data[0].embedding);
          } catch (itemError) {
            this.logger.warn(
              `Individual embed failed (len=${safeBatch[j].length}): ${itemError.message}. Skipping.`,
            );
            // Push a zero vector so indices stay aligned
            const dim = this.dimension || (await this.getDimension());
            results.push(new Array(dim).fill(0));
          }
        }
      }
    }

    return results;
  }

  isReady(): boolean {
    return this.ready;
  }

  getModel(): string {
    return this.model;
  }

  async getDimension(): Promise<number> {
    if (this.dimension) return this.dimension;
    const vec = await this.embed('dimension probe');
    this.dimension = vec.length;
    return this.dimension;
  }
}
