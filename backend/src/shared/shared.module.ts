import { Module, Global } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { VectorstoreService } from './vectorstore.service';
import { DatabaseService } from './database.service';
import { LlmService } from './llm.service';
import { RerankService } from './rerank.service';

@Global()
@Module({
  providers: [
    EmbeddingsService,
    VectorstoreService,
    DatabaseService,
    LlmService,
    RerankService,
  ],
  exports: [
    EmbeddingsService,
    VectorstoreService,
    DatabaseService,
    LlmService,
    RerankService,
  ],
})
export class SharedModule {}
