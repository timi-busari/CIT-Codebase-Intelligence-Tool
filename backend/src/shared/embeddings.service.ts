import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private client: OpenAI;
  private model: string;
  private provider: 'openai' | 'ollama';
  private ready = false;
  private dimension: number | null = null;

  constructor(private config: ConfigService) {}

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
        'nomic-embed-text',
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

  async embed(text: string): Promise<number[]> {
    if (!this.ready) throw new Error('Embedding service not initialized');
    
    // Debug logging
    this.logger.log(`Embedding text: "${text}" (length: ${text.length})`);
    
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.ready) throw new Error('Embedding service not initialized');
    if (texts.length === 0) return [];

    // OpenAI supports batching natively; Ollama may need individual calls
    const batchSize = this.provider === 'openai' ? 100 : 1;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // Safety check: truncate any texts that are still too long
      const safeBatch = batch.map((text, idx) => {
        const chars = text.length;

        if (chars > 4000) {
          // Conservative limit - ~1000 tokens max
          const truncated = text.substring(0, 4000) + '\n...';
          this.logger.warn(
            `⚠️ TRUNCATING text ${i + idx}: ${chars} → ${truncated.length} chars`,
          );
          return truncated;
        }

        this.logger.debug(`Embedding text ${i + idx}: ${chars} chars`);
        return text;
      });

      const response = await this.client.embeddings.create({
        model: this.model,
        input: safeBatch,
      });
      results.push(...response.data.map((d) => d.embedding));
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
