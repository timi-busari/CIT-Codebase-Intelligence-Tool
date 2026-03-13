import { Module } from '@nestjs/common';
import { PrAnalysisController } from './pr-analysis.controller';
import { PrAnalysisService } from './pr-analysis.service';

@Module({
  controllers: [PrAnalysisController],
  providers: [PrAnalysisService],
})
export class PrAnalysisModule {}
