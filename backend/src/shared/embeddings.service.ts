import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private pipeline: any;
  private ready = false;
  private loadPromise: Promise<void> | null = null;

  onModuleInit() {
    // Start loading in the background — don't block server startup
    this.loadPromise = this.loadModel();
  }

  private async loadModel(): Promise<void> {
    this.logger.log('Loading embedding model (all-MiniLM-L6-v2)...');
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
      );
      this.ready = true;
      this.logger.log('Embedding model loaded successfully.');
    } catch (err) {
      this.logger.error('Failed to load embedding model', err);
    }
  }

  private async waitForReady(): Promise<void> {
    if (this.ready) return;
    if (this.loadPromise) await this.loadPromise;
    if (!this.ready) throw new Error('Embedding model failed to load');
  }

  async embed(text: string): Promise<number[]> {
    await this.waitForReady();
    const output = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  isReady(): boolean {
    return this.ready;
  }
}
