import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { ChunkingService } from './chunking.service';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionGateway } from './ingestion.gateway';
import { IngestionQueueModule } from './ingestion.queue';

@Module({
  imports: [IngestionQueueModule],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    ChunkingService,
    IngestionProcessor,
    IngestionGateway,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
