import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    tenantId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string;
  }) {
    return this.prisma.notification.create({ data });
  }

  async findForUser(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async markRead(tenantId: string, userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, tenantId, userId },
      data: { read: true },
    });
  }

  async markAllRead(tenantId: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { tenantId, userId, read: false },
      data: { read: true },
    });
  }

  async hasUnreadOfTypeForPeriod(
    userId: string,
    type: string,
    period: string,
  ): Promise<boolean> {
    const count = await this.prisma.notification.count({
      where: { userId, type, read: false, body: { contains: period } },
    });
    return count > 0;
  }
}
