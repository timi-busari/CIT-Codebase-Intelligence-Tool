import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('api/repos')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Post(':id/health/compute')
  @HttpCode(HttpStatus.OK)
  computeMetrics(@Param('id') id: string) {
    return this.healthService.computeMetrics(id);
  }

  @Get(':id/health')
  getHealth(@Param('id') id: string) {
    return this.healthService.getHealth(id);
  }
}
