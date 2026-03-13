import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

@Controller('api/repos')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post(':id/onboarding')
  @HttpCode(HttpStatus.OK)
  generate(@Param('id') id: string) {
    return this.onboardingService.generate(id);
  }

  @Get(':id/onboarding/history')
  getHistory(@Param('id') id: string) {
    return this.onboardingService.getHistory(id);
  }

  @Get(':id/onboarding/versions/:version')
  getVersion(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.onboardingService.getVersion(id, version);
  }
}
