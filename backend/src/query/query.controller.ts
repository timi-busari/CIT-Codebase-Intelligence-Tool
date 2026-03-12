import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryService } from './query.service';

export class QueryDto {
  query: string;
  repoIds?: string[];
  conversationId?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

@Controller('api/query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async query(@Body() dto: QueryDto) {
    return this.queryService.query(
      dto.query,
      dto.repoIds,
      dto.conversationId,
      dto.history,
    );
  }

  @Post('stream')
  async queryStream(@Body() dto: QueryDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      for await (const chunk of this.queryService.queryStream(
        dto.query,
        dto.repoIds,
        dto.conversationId,
        dto.history,
      )) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        if (chunk.done) {
          break;
        }
      }
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({ error: 'Stream failed', token: error.message, done: true })}\n\n`,
      );
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}
