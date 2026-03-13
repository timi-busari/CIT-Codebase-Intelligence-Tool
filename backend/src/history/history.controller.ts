import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';
import { HistoryService } from './history.service';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  repoIds?: string[];

  @IsOptional()
  @IsArray()
  messages?: any[];
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  messages?: any[];
}

export class CreateBookmarkDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsNotEmpty({ message: 'question must not be empty' })
  @IsString()
  question: string;

  @IsNotEmpty({ message: 'answer must not be empty' })
  @IsString()
  answer: string;

  @IsOptional()
  @IsArray()
  sources?: any[];

  @IsOptional()
  @IsArray()
  repoIds?: string[];

  @IsOptional()
  @IsArray()
  tags?: string[];
}

@Controller('api')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  // ── Conversations ───────────────────────────────────────────────────────
  @Get('conversations')
  listConversations(
    @Query('search') search?: string,
    @Query('repoId') repoId?: string,
  ) {
    return this.historyService.listConversations(search, repoId);
  }

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  createConversation(@Body() dto: CreateConversationDto) {
    return this.historyService.createConversation(dto);
  }

  @Get('conversations/:id')
  getConversation(@Param('id') id: string) {
    return this.historyService.getConversation(id);
  }

  @Patch('conversations/:id')
  updateConversation(
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.historyService.updateConversation(id, dto);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteConversation(@Param('id') id: string) {
    return this.historyService.deleteConversation(id);
  }

  // ── Bookmarks ───────────────────────────────────────────────────────────
  @Get('bookmarks')
  listBookmarks(@Query('tag') tag?: string, @Query('search') search?: string) {
    if (search?.trim()) {
      return this.historyService.searchBookmarks(search);
    }
    return this.historyService.listBookmarks(tag);
  }

  @Post('bookmarks')
  @HttpCode(HttpStatus.CREATED)
  createBookmark(@Body() dto: CreateBookmarkDto) {
    return this.historyService.createBookmark(dto);
  }

  @Delete('bookmarks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBookmark(@Param('id') id: string) {
    return this.historyService.deleteBookmark(id);
  }
}
