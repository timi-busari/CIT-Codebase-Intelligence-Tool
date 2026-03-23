import { Module, Global } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { VectorstoreService } from './vectorstore.service';
import { DatabaseService } from './database.service';
import { LlmService } from './llm.service';
import { RerankService } from './rerank.service';
import { CacheService } from './cache.service';

@Global()
@Module({
  providers: [
    EmbeddingsService,
    VectorstoreService,
    DatabaseService,
    LlmService,
    RerankService,
    CacheService,
  ],
  exports: [
    EmbeddingsService,
    VectorstoreService,
    DatabaseService,
    LlmService,
    RerankService,
    CacheService,
  ],
})
export class SharedModule {}
