import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../../shared/email/email.service';
import { redisConnection } from '../submission/queues/submission.queue';
import { VAT_REMINDER_QUEUE } from './vat-reminder.queue';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class VatReminderProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VatReminderProcessor.name);
  private worker!: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      VAT_REMINDER_QUEUE,
      (job: Job) => this.process(job),
      { connection: redisConnection, concurrency: 1 },
    );

    this.worker.on('completed', (job) =>
      this.logger.log(`VAT reminder job ${job.id} completed`),
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`VAT reminder job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async process(_job: Job): Promise<void> {
    const now = new Date();
    // Filing period = previous calendar month
    const periodMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const periodYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const filingPeriod = `${MONTHS[periodMonth]} ${periodYear}`;
    // Due date = 21st of current month
    const dueDate = `21 ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

    const tenants = await this.prisma.asAdmin((tx) =>
      tx.tenant.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          apiKeys: false,
        },
      }),
    );

    this.logger.log(
      `Processing VAT reminders for ${tenants.length} tenants — period: ${filingPeriod}`,
    );

    for (const tenant of tenants) {
      const userRoles = await this.prisma.asAdmin((tx) =>
        tx.userRole.findMany({
          where: {
            tenantId: tenant.id,
            role: { in: ['OWNER', 'ADMIN'] },
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                isActive: true,
              },
            },
          },
        }),
      );

      for (const ur of userRoles) {
        const user = ur.user;
        if (!user.isActive) continue;

        const alreadySent =
          await this.notificationService.hasUnreadOfTypeForPeriod(
            user.id,
            'VAT_REMINDER',
            filingPeriod,
          );
        if (alreadySent) continue;

        await this.notificationService.create({
          tenantId: tenant.id,
          userId: user.id,
          type: 'VAT_REMINDER',
          title: `VAT Return due — ${filingPeriod}`,
          body: `Your VAT return for ${filingPeriod} is due by ${dueDate}. Open the VAT Return Assistant to download your pre-filled VAT 002 file.`,
          link: '/vat-return',
        });

        this.emailService.sendVatReminder({
          to: user.email,
          firstName: user.firstName,
          tenantName: tenant.name,
          filingPeriod,
          dueDate,
        });

        this.logger.log(
          `VAT reminder sent to ${user.email} (tenant: ${tenant.name}, period: ${filingPeriod})`,
        );
      }
    }
  }
}
