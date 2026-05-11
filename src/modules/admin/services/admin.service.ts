import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import {
  AdminLoginRequest,
  AdminLoginResponse,
  AdminUserResponse,
  CreateAdminUserRequest,
  AdminDashboardStats,
} from "../../../../packages/types/admin";
import * as bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = 8 * 60 * 60; // 8 hours for admin sessions

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Bootstrap first admin user ────────────────────────────────────────────
  async createAdminUser(
    request: CreateAdminUserRequest,
  ): Promise<AdminUserResponse> {
    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.findUnique({ where: { email: request.email } });
    });

    if (existing) {
      throw new ConflictException(
        `Admin user ${request.email} already exists`,
      );
    }

    const passwordHash = await bcrypt.hash(request.password, BCRYPT_ROUNDS);

    const admin = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.create({
        data: {
          email: request.email,
          passwordHash,
          firstName: request.firstName,
          lastName: request.lastName,
          role: request.role ?? "STAFF",
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
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await bcrypt.compare(request.password, admin.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
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
      tokenType: "Bearer",
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
        tx.tenant.count({ where: { environment: "SANDBOX" } }),
        tx.tenant.count({ where: { environment: "PRODUCTION" } }),
        tx.invoice.count(),
        tx.invoice.count({ where: { createdAt: { gte: today } } }),
        tx.invoice.count({ where: { status: "ACCEPTED" } }),
        tx.invoice.count({ where: { status: "REJECTED" } }),
        tx.invoice.count({ where: { status: { in: ["QUEUED", "SUBMITTING"] } } }),
        tx.accessRequest.count({ where: { status: "PENDING" } }),
        tx.accessRequest.count({
          where: { status: "APPROVED", reviewedAt: { gte: weekAgo } },
        }),
        tx.systemError.count({ where: { isResolved: false } }),
        tx.systemError.count({
          where: { severity: "CRITICAL", isResolved: false },
        }),
      ]);
    });

    const acceptanceRate = totalInvoices > 0
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

    const [tenants, total] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.tenant.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            _count: {
              select: { invoices: true, users: true },
            },
          },
        }),
        tx.tenant.count(),
      ]);
    });

    return {
      data: tenants.map((t: any) => ({
        id: t.id,
        name: t.name,
        tin: t.tin,
        environment: t.environment,
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
        tx.invoice.count({ where: { tenantId: id, status: "ACCEPTED" } }),
        tx.invoice.count({ where: { tenantId: id, status: "REJECTED" } }),
      ]);
    });

    const total = (tenant as any)._count.invoices;
    const acceptanceRate = total > 0
      ? Math.round((accepted / total) * 100)
      : 0;

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
          appAdapterKey: options.appAdapterKey ?? "mock",
          environment: (options.environment ?? "SANDBOX") as any,
          rateLimitTier: "STANDARD",
          registeredAddress: {},
        },
      });
    });

    // Mark request as approved
    await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: options.reviewNote ?? null,
        },
      });
    });

    this.logger.log(
      `Access request ${requestId} approved. Tenant created: ${tenant.id}`,
    );

    return {
      message: `Tenant created for ${request.companyName}. Now invite ${request.email} as OWNER.`,
      tenantId: tenant.id,
      tenantName: tenant.name,
      contactEmail: request.email,
      contactName: request.contactName,
    };
  }
async listAccessRequests(status?: string): Promise<any[]> {
    return this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.findMany({
        where: status ? { status: status as any } : undefined,
        orderBy: { createdAt: "desc" },
      });
    });
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
          status: "REJECTED",
          reviewedBy,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
        },
      });
    });
    return { message: `Access request for ${request.companyName} rejected.` };
  }
  // ── List admin users ──────────────────────────────────────────────────────
  async listAdminUsers(): Promise<AdminUserResponse[]> {
    const admins = await this.prisma.asAdmin(async (tx) => {
      return tx.adminUser.findMany({ orderBy: { createdAt: "asc" } });
    });
    return admins.map((a: any) => this.mapToResponse(a));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private issueAdminToken(admin: any): string {
    const secret =
      process.env.ADMIN_JWT_SECRET ??
      process.env.JWT_SECRET ??
      "billinx-admin-secret-change-in-production";

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