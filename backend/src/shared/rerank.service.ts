import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RerankService implements OnModuleInit {
  private readonly logger = new Logger(RerankService.name);
  private cohereClient: any;
  private enabled = false;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const apiKey = this.config.get<string>('COHERE_API_KEY', '');
    if (apiKey) {
      try {
        const { CohereClient } = await import('cohere-ai');
        this.cohereClient = new CohereClient({ token: apiKey });
        this.enabled = true;
        this.logger.log('Cohere re-ranking enabled');
      } catch (err: any) {
        this.logger.warn(`Cohere SDK not available: ${err.message}`);
      }
    } else {
      this.logger.log(
        'COHERE_API_KEY not set — re-ranking disabled, using raw retrieval',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Re-ranks documents against a query using Cohere's rerank API.
   * Returns indices of the top N documents sorted by relevance.
   * Falls back to returning the first topN indices if Cohere is unavailable.
   */
  async rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<number[]> {
    if (!this.enabled || !this.cohereClient || documents.length === 0) {
      return documents.slice(0, topN).map((_, i) => i);
    }

    try {
      const response = await this.cohereClient.v2.rerank({
        model: 'rerank-v3.5',
        query,
        documents,
        topN: Math.min(topN, documents.length),
      });

      const indices = response.results.map((r: { index: number }) => r.index);
      this.logger.debug(
        `Re-ranked ${documents.length} docs → top ${indices.length}`,
      );
      return indices;
    } catch (err: any) {
      this.logger.warn(`Cohere rerank failed, falling back: ${err.message}`);
      return documents.slice(0, topN).map((_, i) => i);
    }
  }
}
