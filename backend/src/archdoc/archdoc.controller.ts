import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { ArchDocService } from './archdoc.service';

@Controller('api/repos')
export class ArchDocController {
  constructor(private readonly archDocService: ArchDocService) {}

  @Post(':id/architecture')
  @HttpCode(HttpStatus.OK)
  generateArchDocs(@Param('id') id: string) {
    return this.archDocService.generate(id);
  }

  @Get(':id/architecture/history')
  getHistory(@Param('id') id: string) {
    return this.archDocService.getHistory(id);
  }

  @Get(':id/architecture/versions/:version')
  getVersion(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.archDocService.getVersion(id, version);
  }
}
