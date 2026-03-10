import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsOptional, IsUrl } from 'class-validator';
import { IngestionService } from './ingestion.service';

export class IngestRepoDto {
  @IsNotEmpty({ message: 'url must not be empty' })
  @IsUrl(
    { protocols: ['https', 'http'], require_protocol: true },
    { message: 'url must be a valid URL' },
  )
  url: string;

  @IsOptional()
  @IsString()
  name?: string;

  /** GitHub Personal Access Token for private repositories */
  @IsOptional()
  @IsString()
  token?: string;
}

@Controller('api/ingest')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(@Body() dto: IngestRepoDto) {
    const job = await this.ingestionService.startIngestion(
      dto.url,
      dto.name,
      dto.token,
    );
    return { jobId: job.jobId, repoId: job.repoId, status: 'queued' };
  }

  @Get('status/:jobId')
  getStatus(@Param('jobId') jobId: string) {
    return this.ingestionService.getJobStatus(jobId);
  }
}
