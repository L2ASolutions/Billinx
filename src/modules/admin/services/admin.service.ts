import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  AdminLoginRequest,
  AdminLoginResponse,
  AdminUserResponse,
  CreateAdminUserRequest,
  AdminDashboardStats,
} from '../../../../packages/types/admin';
import { RedisService } from '../../../shared/redis/redis.service';
import { EmailService } from '../../../shared/email/email.service';
import { ConsentService } from '../../consent/consent.service';
import { submissionQueue } from '../../submission/queues/submission.queue';
import { bulkSubmissionQueue } from '../../submission/queues/bulk-submission.queue';
import { RetentionService } from '../../../shared/retention/retention.service';
import { ExportService } from '../../export/export.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = 8 * 60 * 60; // 8 hours for admin sessions

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly emailService: EmailService,
    private readonly consentService: ConsentService,
    private readonly retentionService: RetentionService,
    private readonly exportService: ExportService,
  ) {}

  // ── Bootstrap first admin user ────────────────────────────────────────────
  async createAdminUser(
    request: CreateAdminUserRequest,
  ): Promise<AdminUserResponse> {
    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.findUnique({ where: { email: request.email } });
    });

    if (existing) {
      throw new ConflictException(`Admin user ${request.email} already exists`);
    }

    const passwordHash = await bcrypt.hash(request.password, BCRYPT_ROUNDS);

    const admin = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.create({
        data: {
          email: request.email,
          passwordHash,
          firstName: request.firstName,
          lastName: request.lastName,
          role: request.role ?? 'STAFF',
        },
      });
    });

    this.logger.log(`Admin user created: ${admin.email} [${admin.role}]`);
    return this.mapToResponse(admin);
  }

  // ── Admin login ───────────────────────────────────────────────────────────
  async login(request: AdminLoginRequest): Promise<AdminLoginResponse> {
    const admin = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.findUnique({ where: { email: request.email } });
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(request.password, admin.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });
    });

    const accessToken = this.issueAdminToken(admin);

    this.logger.log(`Admin login: ${admin.email}`);

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL,
      tokenType: 'Bearer',
      admin: this.mapToResponse(admin),
    };
  }

  // ── Dashboard stats ───────────────────────────────────────────────────────
  async getDashboardStats(): Promise<AdminDashboardStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      totalTenants,
      activeTenants,
      sandboxTenants,
      productionTenants,
      totalInvoices,
      todayInvoices,
      acceptedInvoices,
      rejectedInvoices,
      pendingInvoices,
      pendingRequests,
      approvedThisWeek,
      unresolvedErrors,
      criticalErrors,
    ] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.tenant.count(),
        tx.tenant.count({ where: { isActive: true } }),
        tx.tenant.count({ where: { environment: 'SANDBOX' } }),
        tx.tenant.count({ where: { environment: 'PRODUCTION' } }),
        tx.invoice.count(),
        tx.invoice.count({ where: { createdAt: { gte: today } } }),
        tx.invoice.count({ where: { status: 'ACCEPTED' } }),
        tx.invoice.count({ where: { status: 'REJECTED' } }),
        tx.invoice.count({
          where: { status: { in: ['QUEUED', 'SUBMITTING'] } },
        }),
        tx.accessRequest.count({ where: { status: 'PENDING' } }),
        tx.accessRequest.count({
          where: { status: 'APPROVED', reviewedAt: { gte: weekAgo } },
        }),
        tx.systemError.count({ where: { isResolved: false } }),
        tx.systemError.count({
          where: { severity: 'CRITICAL', isResolved: false },
        }),
      ]);
    });

    const acceptanceRate =
      totalInvoices > 0
        ? Math.round((acceptedInvoices / totalInvoices) * 100)
        : 0;

    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        sandbox: sandboxTenants,
        production: productionTenants,
      },
      invoices: {
        total: totalInvoices,
        today: todayInvoices,
        accepted: acceptedInvoices,
        rejected: rejectedInvoices,
        pending: pendingInvoices,
        acceptanceRate,
      },
      accessRequests: {
        pending: pendingRequests,
        approvedThisWeek,
      },
      errors: {
        unresolved: unresolvedErrors,
        critical: criticalErrors,
      },
    };
  }

  // ── List tenants ──────────────────────────────────────────────────────────
  async listTenants(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const tenants = await this.prisma.asAdmin((tx) =>
      tx.tenant.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { invoices: true, users: true },
          },
        },
      }),
    );

    const total = await this.prisma.asAdmin((tx) => tx.tenant.count());

    return {
      data: tenants.map((t: any) => ({
        id: t.id,
        name: t.name,
        tin: t.tin,
        environment: t.environment,
        rateLimitTier: t.rateLimitTier,
        appAdapterKey: t.appAdapterKey,
        isActive: t.isActive,
        invoiceCount: t._count.invoices,
        userCount: t._count.users,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  // ── Get tenant detail ─────────────────────────────────────────────────────
  async getTenantDetail(id: string) {
    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id },
        include: {
          users: { include: { roles: true } },
          _count: { select: { invoices: true } },
        },
      });
    });

    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    const [accepted, rejected] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.invoice.count({ where: { tenantId: id, status: 'ACCEPTED' } }),
        tx.invoice.count({ where: { tenantId: id, status: 'REJECTED' } }),
      ]);
    });

    const total = (tenant as any)._count.invoices;
    const acceptanceRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

    return {
      id: tenant.id,
      name: tenant.name,
      tin: tenant.tin,
      environment: tenant.environment,
      isActive: tenant.isActive,
      appAdapterKey: tenant.appAdapterKey,
      rateLimitTier: tenant.rateLimitTier,
      registeredAddress: tenant.registeredAddress,
      createdAt: tenant.createdAt.toISOString(),
      users: (tenant as any).users.map((u: any) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        roles: u.roles.map((r: any) => r.role),
        isActive: u.isActive,
        mfaEnabled: u.mfaEnabled ?? false,
        lastLoginAt: u.lastLoginAt?.toISOString(),
      })),
      stats: { total, accepted, rejected, acceptanceRate },
    };
  }

  // ── Approve access request and create tenant ───────────────────────────────
  async approveAndProvision(
    requestId: string,
    adminId: string,
    options: {
      appAdapterKey?: string;
      environment?: string;
      reviewNote?: string;
    },
  ) {
    const request = await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.findUnique({ where: { id: requestId } });
    });

    if (!request) {
      throw new NotFoundException(`Access request ${requestId} not found`);
    }

    // Create tenant
    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.create({
        data: {
          name: request.companyName,
          tin: request.tin,
          appAdapterKey: options.appAdapterKey ?? 'mock',
          environment: (options.environment ?? 'SANDBOX') as any,
          rateLimitTier: 'STANDARD',
          registeredAddress: {},
        },
      });
    });

    // Mark request as approved
    await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: options.reviewNote ?? null,
        },
      });
    });

    this.logger.log(
      `Access request ${requestId} approved. Tenant created: ${tenant.id}`,
    );

    this.emailService.sendAccessRequestApproved({
      to: request.email,
      contactName: request.contactName,
      companyName: request.companyName,
    });

    return {
      message: `Tenant created for ${request.companyName}. Now invite ${request.email} as OWNER.`,
      tenantId: tenant.id,
      tenantName: tenant.name,
      contactEmail: request.email,
      contactName: request.contactName,
    };
  }
  async listAccessRequests(status?: string): Promise<any[]> {
    const requests = await this.prisma.asAdmin((tx) =>
      tx.accessRequest.findMany({
        where: status ? { status: status as any } : undefined,
        orderBy: { createdAt: 'desc' },
        include: { kybVerification: true },
      }),
    );

    return requests.map((r: any) => ({
      id: r.id,
      companyName: r.companyName,
      tin: r.tin,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      estimatedVolume: r.estimatedVolume,
      useCase: r.useCase,
      status: r.status,
      cacRcNumber: r.cacRcNumber,
      kybScore: r.kybScore,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString(),
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      kybVerification: r.kybVerification
        ? {
            id: r.kybVerification.id,
            tinUserConfirmed: r.kybVerification.tinUserConfirmed,
            tinConfirmedAt: r.kybVerification.tinConfirmedAt?.toISOString(),
            tinProofNote: r.kybVerification.tinProofNote,
            cacVerified: r.kybVerification.cacVerified,
            cacCompanyName: r.kybVerification.cacCompanyName,
            cacStatus: r.kybVerification.cacStatus,
            cacRegistrationDate: r.kybVerification.cacRegistrationDate,
            cacDirectors: r.kybVerification.cacDirectors,
            nameMatchScore: r.kybVerification.nameMatchScore,
            nameMatchResult: r.kybVerification.nameMatchResult,
            riskScore: r.kybVerification.riskScore,
            riskReasons: r.kybVerification.riskReasons,
            cacErrorMessage: r.kybVerification.cacErrorMessage,
          }
        : null,
    }));
  }

  async rejectAccessRequest(
    id: string,
    reviewedBy: string,
    reviewNote?: string,
  ): Promise<{ message: string }> {
    const request = await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.findUnique({ where: { id } });
    });
    if (!request) throw new NotFoundException(`Access request ${id} not found`);
    await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedBy,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
        },
      });
    });
    return { message: `Access request for ${request.companyName} rejected.` };
  }
  // ── Account unlock ────────────────────────────────────────────────────────
  async unlockAccount(
    tenantId: string,
    email: string,
  ): Promise<{ message: string }> {
    await this.redisService.clearLoginFailures(tenantId, email);
    this.logger.log(
      `Account unlocked by admin: tenantId=${tenantId} email=${email}`,
    );
    return { message: `Account for ${email} has been unlocked.` };
  }

  // ── List admin users ──────────────────────────────────────────────────────
  async listAdminUsers(): Promise<AdminUserResponse[]> {
    const admins = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    });
    return admins.map((a: any) => this.mapToResponse(a));
  }

  // ── Consent records ───────────────────────────────────────────────────────
  async listConsentRecords(filters: {
    tenantId?: string;
    email?: string;
    consentType?: string;
  }) {
    return this.consentService.listAll(filters);
  }

  // ── Erasure requests ──────────────────────────────────────────────────────
  async listErasureRequests(status?: string) {
    return this.consentService.listErasureRequests(status);
  }

  async approveErasure(id: string, adminId: string, reviewNote?: string) {
    return this.consentService.approveErasure(id, adminId, reviewNote);
  }

  async rejectErasure(id: string, adminId: string, reviewNote?: string) {
    return this.consentService.rejectErasure(id, adminId, reviewNote);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private issueAdminToken(admin: any): string {
    const secret =
      process.env.ADMIN_JWT_SECRET ??
      process.env.JWT_SECRET ??
      'billinx-admin-secret-change-in-production';

    return jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        isAdmin: true,
      },
      secret,
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  async getMetrics() {
    const now = new Date();

    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);

    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const [
      todayTotal,
      todayAccepted,
      weekTotal,
      weekAccepted,
      monthTotal,
      monthAccepted,
      activeTenants,
      recentErrors,
      totalDeliveries24h,
      deliveredDeliveries24h,
    ] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.invoice.count({ where: { createdAt: { gte: todayMidnight } } }),
        tx.invoice.count({
          where: { createdAt: { gte: todayMidnight }, status: 'ACCEPTED' },
        }),
        tx.invoice.count({ where: { createdAt: { gte: monday } } }),
        tx.invoice.count({
          where: { createdAt: { gte: monday }, status: 'ACCEPTED' },
        }),
        tx.invoice.count({ where: { createdAt: { gte: monthStart } } }),
        tx.invoice.count({
          where: { createdAt: { gte: monthStart }, status: 'ACCEPTED' },
        }),
        tx.tenant.count({ where: { isActive: true } }),
        tx.systemError.count({ where: { occurredAt: { gte: yesterday } } }),
        tx.webhookDelivery.count({ where: { createdAt: { gte: yesterday } } }),
        tx.webhookDelivery.count({
          where: { createdAt: { gte: yesterday }, status: 'DELIVERED' },
        }),
      ]);
    });

    return {
      invoices: {
        today: {
          total: todayTotal,
          accepted: todayAccepted,
          acceptanceRate:
            todayTotal > 0 ? Math.round((todayAccepted / todayTotal) * 100) : 0,
        },
        week: {
          total: weekTotal,
          accepted: weekAccepted,
          acceptanceRate:
            weekTotal > 0 ? Math.round((weekAccepted / weekTotal) * 100) : 0,
        },
        month: {
          total: monthTotal,
          accepted: monthAccepted,
          acceptanceRate:
            monthTotal > 0 ? Math.round((monthAccepted / monthTotal) * 100) : 0,
        },
      },
      activeTenants,
      errors: { last24h: recentErrors },
      webhooks: {
        deliveriesLast24h: totalDeliveries24h,
        successfulLast24h: deliveredDeliveries24h,
        successRate:
          totalDeliveries24h > 0
            ? Math.round((deliveredDeliveries24h / totalDeliveries24h) * 100)
            : 0,
      },
      generatedAt: now.toISOString(),
    };
  }

  // ── Queue monitoring ──────────────────────────────────────────────────────
  async getQueueStatus() {
    try {
      const counts = await submissionQueue.getJobCounts();
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    } catch (err: any) {
      this.logger.error(`Queue status failed: ${err.message}`);
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        error: err.message,
      };
    }
  }

  async retryFailedJobs() {
    try {
      const failedJobs = await submissionQueue.getFailed();
      let retried = 0;
      for (const job of failedJobs) {
        await job.retry();
        retried++;
      }
      this.logger.log(`Retried ${retried} failed submission jobs`);
      return { retried };
    } catch (err: any) {
      this.logger.error(`Retry failed jobs error: ${err.message}`);
      return { retried: 0, error: err.message };
    }
  }

  // ── Bulk queue monitoring ─────────────────────────────────────────────────
  async getBulkQueueStatus() {
    try {
      const counts = await bulkSubmissionQueue.getJobCounts();
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    } catch (err: any) {
      this.logger.error(`Bulk queue status failed: ${err.message}`);
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        error: err.message,
      };
    }
  }

  // ── Data retention ────────────────────────────────────────────────────────
  async getRetentionStats() {
    return this.retentionService.getRetentionStats();
  }

  async runRetention() {
    const [invoices, events] = await Promise.all([
      this.retentionService.archiveOldInvoices(),
      this.retentionService.archiveOldActivityEvents(),
    ]);
    return {
      invoicesArchived: invoices.archived,
      activityEventsArchived: events.archived,
      ranAt: new Date().toISOString(),
    };
  }

  // ── Export ───────────────────────────────────────────────────────────────
  async exportPlatformCSV(startDate: string, endDate: string): Promise<string> {
    return this.exportService.exportPlatformCSV(startDate, endDate);
  }

  // ── Audit chain verification ──────────────────────────────────────────────
  async verifyAuditChain(): Promise<{
    valid: boolean;
    totalEvents: number;
    brokenAt: string | null;
  }> {
    const events = await this.prisma.asAdmin(async (tx) => {
      return (tx as any).activityEvent.findMany({
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          tenantId: true,
          eventType: true,
          actor: true,
          occurredAt: true,
          payload: true,
          entryHash: true,
          previousHash: true,
        },
      });
    });

    let brokenAt: string | null = null;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event.entryHash) continue;

      const previousHash = event.previousHash ?? 'GENESIS';
      const payloadStr = JSON.stringify(event.payload);
      const hashInput = `${event.tenantId}|${event.eventType}|${event.actor}|${new Date(event.occurredAt).toISOString()}|${payloadStr}|${previousHash}`;
      const expectedHash = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');

      if (expectedHash !== event.entryHash) {
        brokenAt = event.id;
        break;
      }
    }

    return {
      valid: brokenAt === null,
      totalEvents: events.length,
      brokenAt,
    };
  }

  private mapToResponse(admin: any): AdminUserResponse {
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      fullName: `${admin.firstName} ${admin.lastName}`.trim(),
      role: admin.role,
      isActive: admin.isActive,
      lastLoginAt: admin.lastLoginAt?.toISOString(),
      createdAt: admin.createdAt.toISOString(),
    };
  }
}
