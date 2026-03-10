import { Module, Global } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { VectorstoreService } from './vectorstore.service';
import { DatabaseService } from './database.service';
import { LlmService } from './llm.service';

@Global()
@Module({
  providers: [
    EmbeddingsService,
    VectorstoreService,
    DatabaseService,
    LlmService,
  ],
  exports: [EmbeddingsService, VectorstoreService, DatabaseService, LlmService],
})
export class SharedModule {}
