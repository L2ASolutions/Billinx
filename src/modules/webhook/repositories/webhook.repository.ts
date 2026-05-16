import { Injectable } from '@nestjs/common';
import { Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class WebhookRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSubscription(data: {
    tenantId: string;
    url: string;
    signingKey: Buffer;
    signingIv: Buffer;
    eventTypes: string[];
    description?: string;
  }) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookSubscription.create({ data });
    });
  }

  async findSubscriptionById(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookSubscription.findUnique({ where: { id } });
    });
  }

  async findSubscriptionsByTenant(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookSubscription.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async findActiveSubscriptionsForEvent(tenantId: string, eventType: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookSubscription.findMany({
        where: { tenantId, isActive: true, eventTypes: { has: eventType } },
      });
    });
  }

  async updateSubscription(
    id: string,
    data: {
      url?: string;
      eventTypes?: string[];
      isActive?: boolean;
      description?: string | null;
    },
  ) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookSubscription.update({ where: { id }, data });
    });
  }

  async deleteSubscription(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookSubscription.delete({ where: { id } });
    });
  }

  async createDelivery(data: {
    subscriptionId: string;
    tenantId: string;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
  }) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookDelivery.create({
        data: { ...data, payload: data.payload as Prisma.InputJsonValue },
      });
    });
  }

  async findDeliveryById(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookDelivery.findUnique({
        where: { id },
        include: { subscription: true },
      });
    });
  }

  async findDeliveriesByTenant(tenantId: string, status?: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookDelivery.findMany({
        where: {
          tenantId,
          ...(status ? { status: status as WebhookDeliveryStatus } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }

  async updateDelivery(
    id: string,
    data: {
      attemptCount?: number;
      lastAttemptAt?: Date;
      nextRetryAt?: Date | null;
      status?: string;
      lastResponseCode?: number | null;
      lastResponseBody?: string | null;
      deliveredAt?: Date | null;
    },
  ) {
    const { status, ...rest } = data;
    return this.prisma.asAdmin(async (tx) => {
      return tx.webhookDelivery.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? { status: status as WebhookDeliveryStatus } : {}),
        },
      });
    });
  }
}
