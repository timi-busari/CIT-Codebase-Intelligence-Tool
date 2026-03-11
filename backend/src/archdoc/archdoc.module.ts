import { Module } from '@nestjs/common';
import { ArchDocController } from './archdoc.controller';
import { ArchDocService } from './archdoc.service';

@Module({
  controllers: [ArchDocController],
  providers: [ArchDocService],
})
export class ArchDocModule {}
