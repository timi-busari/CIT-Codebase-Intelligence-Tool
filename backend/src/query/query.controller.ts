import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { QueryService } from './query.service';

export class QueryDto {
  question: string;
  repoIds?: string[]; // empty = search all repos
  conversationId?: string;
}

@Controller('api/query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async query(@Body() dto: QueryDto) {
    return this.queryService.query(
      dto.question,
      dto.repoIds,
      dto.conversationId,
    );
  }
}
