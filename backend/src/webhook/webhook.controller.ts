import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('api')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('repos/:id/webhook/setup')
  @HttpCode(HttpStatus.OK)
  setupWebhook(@Param('id') id: string) {
    return this.webhookService.setupWebhook(id);
  }

  @Post('webhooks/github/:repoId')
  @HttpCode(HttpStatus.OK)
  async handleGithubPush(
    @Param('repoId') repoId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: any,
  ) {
    return this.webhookService.handleGithubPush(repoId, signature, payload);
  }
}
