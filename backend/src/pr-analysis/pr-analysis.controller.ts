import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { PrAnalysisService } from './pr-analysis.service';

export class AnalyzePrDto {
  @IsNotEmpty()
  @IsString()
  repoId: string;

  @IsNotEmpty()
  @IsString()
  repoUrl: string;

  @IsNotEmpty()
  @IsNumber()
  prNumber: number;

  @IsOptional()
  @IsString()
  githubToken?: string;
}

@Controller('api')
export class PrAnalysisController {
  constructor(private readonly prAnalysisService: PrAnalysisService) {}

  @Post('pr-analysis')
  @HttpCode(HttpStatus.OK)
  analyze(@Body() dto: AnalyzePrDto) {
    return this.prAnalysisService.analyze(dto);
  }

  @Get('repos/:id/pr-analyses')
  listByRepo(@Param('id') id: string) {
    return this.prAnalysisService.listByRepo(id);
  }

  @Get('pr-analysis/:id')
  getById(@Param('id') id: string) {
    return this.prAnalysisService.getById(id);
  }
}
