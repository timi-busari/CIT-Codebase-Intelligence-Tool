import {
  Controller,
  Get,
  Param,
  Query,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReposService } from './repos.service';

@Controller('api/repos')
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  @Get()
  listRepos() {
    return this.reposService.listRepos();
  }

  @Delete('/all')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAllRepos() {
    return this.reposService.deleteAllRepos();
  }

  @Get(':id')
  getRepo(@Param('id') id: string) {
    return this.reposService.getRepo(id);
  }

  @Get(':id/files')
  getFileTree(@Param('id') id: string) {
    return this.reposService.getFileTree(id);
  }

  @Get(':id/file')
  getFileContent(@Param('id') id: string, @Query('path') filePath: string) {
    return this.reposService.getFileContent(id, filePath);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRepo(@Param('id') id: string) {
    await this.reposService.deleteRepo(id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMultipleRepos(@Query('ids') ids: string) {
    const idArray = ids.split(',');
    return this.reposService.deleteMultipleRepos(idArray);
  }
}
