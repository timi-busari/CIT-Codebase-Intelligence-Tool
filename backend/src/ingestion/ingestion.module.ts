import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { ChunkingService } from './chunking.service';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, ChunkingService],
  exports: [IngestionService],
})
export class IngestionModule {}
