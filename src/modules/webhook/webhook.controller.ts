import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { WebhookService } from './services/webhook.service';
import { FlexAuthGuard } from '../identity/guards/flex-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { getRequestContext } from '../../shared/context/request-context';
import {
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
  WEBHOOK_EVENT_TYPES,
} from '../../../packages/types/webhook';

@ApiTags('Webhooks')
@ApiBearerAuth()
@UseGuards(FlexAuthGuard)
@Controller('v1/webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // ─── Subscriptions ────────────────────────────────────────────────────────

  @Post('subscriptions')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a webhook subscription' })
  async createSubscription(@Body() body: CreateSubscriptionRequest) {
    const { tenantId } = getRequestContext();
    return this.webhookService.createSubscription(tenantId, body);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List webhook subscriptions' })
  async listSubscriptions() {
    const { tenantId } = getRequestContext();
    return this.webhookService.listSubscriptions(tenantId);
  }

  @Get('subscriptions/:id')
  @ApiOperation({ summary: 'Get a webhook subscription' })
  async getSubscription(@Param('id') id: string) {
    const { tenantId } = getRequestContext();
    return this.webhookService.getSubscription(id, tenantId);
  }

  @Patch('subscriptions/:id')
  @ApiOperation({ summary: 'Update a webhook subscription' })
  async updateSubscription(
    @Param('id') id: string,
    @Body() body: UpdateSubscriptionRequest,
  ) {
    const { tenantId } = getRequestContext();
    return this.webhookService.updateSubscription(id, tenantId, body);
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  async deleteSubscription(@Param('id') id: string) {
    const { tenantId } = getRequestContext();
    await this.webhookService.deleteSubscription(id, tenantId);
  }

  // ─── Deliveries ───────────────────────────────────────────────────────────

  @Get('deliveries')
  @ApiOperation({ summary: 'List webhook deliveries' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTERED'],
  })
  async listDeliveries(@Query('status') status?: string) {
    const { tenantId } = getRequestContext();
    return this.webhookService.listDeliveries(tenantId, status);
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Get a webhook delivery' })
  async getDelivery(@Param('id') id: string) {
    const { tenantId } = getRequestContext();
    return this.webhookService.getDelivery(id, tenantId);
  }

  @Post('deliveries/:id/retry')
  @ApiOperation({ summary: 'Retry a failed or dead-lettered webhook delivery' })
  async retryDelivery(@Param('id') id: string) {
    const { tenantId } = getRequestContext();
    return this.webhookService.retryDelivery(id, tenantId);
  }

  // ─── Event types ──────────────────────────────────────────────────────────

  @Get('event-types')
  @ApiOperation({ summary: 'List available webhook event types' })
  async listEventTypes() {
    return { eventTypes: WEBHOOK_EVENT_TYPES };
  }
}
