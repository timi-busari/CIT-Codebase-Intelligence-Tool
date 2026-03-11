import { Controller, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ArchDocService } from './archdoc.service';

@Controller('api/repos')
export class ArchDocController {
  constructor(private readonly archDocService: ArchDocService) {}

  @Post(':id/architecture')
  @HttpCode(HttpStatus.OK)
  generateArchDocs(@Param('id') id: string) {
    return this.archDocService.generate(id);
  }
}
