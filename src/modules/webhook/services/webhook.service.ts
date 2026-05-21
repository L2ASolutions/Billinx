import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { WebhookRepository } from '../repositories/webhook.repository';
import { CredentialService } from '../../tenant/services/credential.service';
import { SecretsService } from '../../../infrastructure/secrets/secrets.service';
import { addToWebhookQueue } from '../queues/webhook.queue';
import {
  WebhookInvoiceEvent,
  WebhookEventType,
  WEBHOOK_EVENT_TYPES,
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
  WebhookSubscriptionResponse,
  WebhookDeliveryResponse,
} from '../../../../packages/types/webhook';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 15_000];
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 1_000;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly credentialService: CredentialService,
    private readonly secretsService: SecretsService,
  ) {}

  // ─── Subscription management ─────────────────────────────────────────────

  async createSubscription(
    tenantId: string,
    request: CreateSubscriptionRequest,
  ): Promise<WebhookSubscriptionResponse> {
    this.validateUrl(request.url);
    this.validateEventTypes(request.eventTypes);

    const masterKey = await this.secretsService.getMasterEncryptionKey();
    const rawSigningKey = crypto.randomBytes(32);
    const { encrypted, iv } = this.credentialService.encrypt(
      rawSigningKey.toString('hex'),
      masterKey,
      tenantId,
    );

    const subscription = await this.webhookRepository.createSubscription({
      tenantId,
      url: request.url,
      signingKey: encrypted,
      signingIv: iv,
      eventTypes: request.eventTypes,
      description: request.description,
    });

    return this.mapSubscription(subscription);
  }

  async listSubscriptions(
    tenantId: string,
  ): Promise<WebhookSubscriptionResponse[]> {
    const subs =
      await this.webhookRepository.findSubscriptionsByTenant(tenantId);
    return subs.map((s) => this.mapSubscription(s));
  }

  async getSubscription(
    id: string,
    tenantId: string,
  ): Promise<WebhookSubscriptionResponse> {
    const sub = await this.assertSubscriptionOwnership(id, tenantId);
    return this.mapSubscription(sub);
  }

  async updateSubscription(
    id: string,
    tenantId: string,
    request: UpdateSubscriptionRequest,
  ): Promise<WebhookSubscriptionResponse> {
    await this.assertSubscriptionOwnership(id, tenantId);

    if (request.url) this.validateUrl(request.url);
    if (request.eventTypes) this.validateEventTypes(request.eventTypes);

    const updated = await this.webhookRepository.updateSubscription(id, {
      url: request.url,
      eventTypes: request.eventTypes,
      isActive: request.isActive,
      description: request.description ?? undefined,
    });

    return this.mapSubscription(updated);
  }

  async deleteSubscription(id: string, tenantId: string): Promise<void> {
    await this.assertSubscriptionOwnership(id, tenantId);
    await this.webhookRepository.deleteSubscription(id);
  }

  // ─── Delivery management ─────────────────────────────────────────────────

  async listDeliveries(
    tenantId: string,
    status?: string,
  ): Promise<WebhookDeliveryResponse[]> {
    const deliveries = await this.webhookRepository.findDeliveriesByTenant(
      tenantId,
      status,
    );
    return deliveries.map((d) => this.mapDelivery(d));
  }

  async getDelivery(
    id: string,
    tenantId: string,
  ): Promise<WebhookDeliveryResponse> {
    const delivery = await this.webhookRepository.findDeliveryById(id);
    if (!delivery || delivery.tenantId !== tenantId) {
      throw new NotFoundException(`Webhook delivery ${id} not found`);
    }
    return this.mapDelivery(delivery);
  }

  async retryDelivery(
    id: string,
    tenantId: string,
  ): Promise<WebhookDeliveryResponse> {
    const delivery = await this.webhookRepository.findDeliveryById(id);
    if (!delivery || delivery.tenantId !== tenantId) {
      throw new NotFoundException(`Webhook delivery ${id} not found`);
    }

    if (delivery.status === 'DELIVERED') {
      throw new BadRequestException('Delivery already succeeded');
    }

    await this.webhookRepository.updateDelivery(id, {
      status: 'PENDING',
      attemptCount: 0,
      nextRetryAt: null,
    });

    await addToWebhookQueue({ deliveryId: id });

    const updated = await this.webhookRepository.findDeliveryById(id);
    return this.mapDelivery(updated!);
  }

  // ─── Event dispatch (called by event listeners) ───────────────────────────

  @OnEvent('invoice.created')
  async onInvoiceCreated(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('invoice.accepted')
  async onInvoiceAccepted(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('invoice.rejected')
  async onInvoiceRejected(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('invoice.cancelled')
  async onInvoiceCancelled(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('invoice.overdue')
  async onInvoiceOverdue(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('invoice.reminder_sent')
  async onInvoiceReminderSent(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('payment.confirmed')
  async onPaymentConfirmed(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  @OnEvent('payment.partial')
  async onPaymentPartial(event: WebhookInvoiceEvent) {
    await this.dispatchEvent(event);
  }

  private async dispatchEvent(event: WebhookInvoiceEvent): Promise<void> {
    try {
      const subscriptions =
        await this.webhookRepository.findActiveSubscriptionsForEvent(
          event.tenantId,
          event.eventType,
        );

      if (subscriptions.length === 0) return;

      const eventId = crypto.randomUUID();
      const payload = {
        id: eventId,
        type: event.eventType,
        tenantId: event.tenantId,
        createdAt: new Date().toISOString(),
        data: event.data,
      };

      await Promise.all(
        subscriptions.map(async (sub) => {
          const delivery = await this.webhookRepository.createDelivery({
            subscriptionId: sub.id,
            tenantId: event.tenantId,
            eventType: event.eventType,
            eventId,
            payload,
          });
          await addToWebhookQueue({ deliveryId: delivery.id });
        }),
      );

      this.logger.log(
        `Dispatched ${event.eventType} to ${subscriptions.length} subscription(s) for tenant ${event.tenantId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to dispatch ${event.eventType}: ${err.message}`,
      );
    }
  }

  // ─── Worker entry point ───────────────────────────────────────────────────

  async processDelivery(
    deliveryId: string,
    attemptsMade: number,
  ): Promise<void> {
    const delivery = await this.webhookRepository.findDeliveryById(deliveryId);
    if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);

    const subscription = (delivery as any).subscription;
    const masterKey = await this.secretsService.getMasterEncryptionKey();
    const signingKeyHex = this.credentialService.decrypt(
      Buffer.from(subscription.signingKey),
      Buffer.from(subscription.signingIv),
      masterKey,
      subscription.tenantId,
    );

    const isLastAttempt = attemptsMade >= MAX_ATTEMPTS - 1;
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const result = await this.makeHttpDelivery(
        subscription.url,
        delivery.payload as Record<string, unknown>,
        signingKeyHex,
        deliveryId,
        delivery.eventType,
      );
      statusCode = result.statusCode;
      responseBody = result.body;
      success = statusCode >= 200 && statusCode < 300;
    } catch (err: any) {
      responseBody =
        err.name === 'AbortError' ? 'Request timed out' : err.message;
    }

    const attemptCount = delivery.attemptCount + 1;

    if (success) {
      await this.webhookRepository.updateDelivery(deliveryId, {
        status: 'DELIVERED',
        attemptCount,
        lastAttemptAt: new Date(),
        lastResponseCode: statusCode,
        lastResponseBody: responseBody,
        deliveredAt: new Date(),
        nextRetryAt: null,
      });
      this.logger.log(
        `Webhook delivery ${deliveryId} delivered (HTTP ${statusCode})`,
      );
      return;
    }

    const nextStatus = isLastAttempt ? 'DEAD_LETTERED' : 'FAILED';
    const nextRetryAt = isLastAttempt
      ? null
      : new Date(Date.now() + (RETRY_DELAYS_MS[attemptsMade] ?? 5_000));

    await this.webhookRepository.updateDelivery(deliveryId, {
      status: nextStatus,
      attemptCount,
      lastAttemptAt: new Date(),
      lastResponseCode: statusCode,
      lastResponseBody: responseBody,
      nextRetryAt,
    });

    if (isLastAttempt) {
      this.logger.warn(
        `Webhook delivery ${deliveryId} dead-lettered after ${MAX_ATTEMPTS} attempts`,
      );
      return;
    }

    this.logger.warn(
      `Webhook delivery ${deliveryId} failed (attempt ${attemptCount}/${MAX_ATTEMPTS}), retrying...`,
    );
    throw new Error(`HTTP ${statusCode ?? 'timeout'}: ${responseBody}`);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async makeHttpDelivery(
    url: string,
    payload: Record<string, unknown>,
    signingKeyHex: string,
    deliveryId: string,
    eventType: string,
  ): Promise<{ statusCode: number; body: string }> {
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', Buffer.from(signingKeyHex, 'hex'))
      .update(body)
      .digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Billinx-Webhooks/1.0',
          'X-Billinx-Event': eventType,
          'X-Billinx-Delivery': deliveryId,
          'X-Billinx-Timestamp': timestamp,
          'X-Billinx-Signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      return {
        statusCode: response.status,
        body: text.slice(0, MAX_RESPONSE_BODY),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Webhook URL must use HTTPS');
    }

    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '0.0.0.0') {
      throw new BadRequestException(
        'Webhook URL cannot target a private or reserved address',
      );
    }

    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new BadRequestException(
        'Webhook URL cannot target a private or reserved address',
      );
    }

    // Block private IPv4 ranges + AWS metadata endpoint
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      const isPrivate =
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168);
      if (isPrivate) {
        throw new BadRequestException(
          'Webhook URL cannot target a private or reserved address',
        );
      }
    }

    // Block IPv6 loopback and private ranges
    const bare = hostname.replace(/^\[|\]$/g, '');
    if (
      bare === '::1' ||
      bare.startsWith('fc') ||
      bare.startsWith('fd') ||
      bare.startsWith('fe8')
    ) {
      throw new BadRequestException(
        'Webhook URL cannot target a private or reserved address',
      );
    }
  }

  private validateEventTypes(eventTypes: string[]): void {
    if (!eventTypes || eventTypes.length === 0) {
      throw new BadRequestException('At least one event type is required');
    }
    const invalid = eventTypes.filter(
      (e) => !WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid event types: ${invalid.join(', ')}. Valid types: ${WEBHOOK_EVENT_TYPES.join(', ')}`,
      );
    }
  }

  private async assertSubscriptionOwnership(id: string, tenantId: string) {
    const sub = await this.webhookRepository.findSubscriptionById(id);
    if (!sub)
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (sub.tenantId !== tenantId)
      throw new ForbiddenException('Access denied');
    return sub;
  }

  private mapSubscription(sub: any): WebhookSubscriptionResponse {
    return {
      id: sub.id,
      tenantId: sub.tenantId,
      url: sub.url,
      eventTypes: sub.eventTypes,
      isActive: sub.isActive,
      description: sub.description ?? null,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
  }

  private mapDelivery(d: any): WebhookDeliveryResponse {
    return {
      id: d.id,
      subscriptionId: d.subscriptionId,
      tenantId: d.tenantId,
      eventType: d.eventType,
      eventId: d.eventId,
      status: d.status,
      attemptCount: d.attemptCount,
      lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
      nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
      lastResponseCode: d.lastResponseCode ?? null,
      lastResponseBody: d.lastResponseBody ?? null,
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
