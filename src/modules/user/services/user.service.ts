import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { UserRepository } from "../repositories/user.repository";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { SecretsService } from "../../../infrastructure/secrets/secrets.service";
import { ActivityService } from "../../activity/services/activity.service";
import { RedisService } from "../../../shared/redis/redis.service";
import { EmailService } from "../../../shared/email/email.service";
import { MfaService } from "./mfa.service";
import { ConsentService } from "../../consent/consent.service";
import {
  UserRoleType,
  ROLE_PERMISSIONS,
  RegisterTenantRequest,
  InviteUserRequest,
  AcceptInvitationRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  UpdateUserRequest,
  UserResponse,
  UserListResponse,
  RegisterResponse,
  LoginResponse,
  MfaChallengeResponse,
} from "../../../../packages/types/user";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { checkRole } from "../../../shared/utils/role-checker";

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = 15 * 60;
const INVITATION_TTL_DAYS = 7;
const PASSWORD_RESET_TTL_HOURS = 2;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly activityService: ActivityService,
    private readonly redisService: RedisService,
    private readonly emailService: EmailService,
    private readonly mfaService: MfaService,
    private readonly consentService: ConsentService,
  ) {}

  // â"€â"€ Self-serve registration (Route 2 â€" small businesses) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async registerTenant(request: RegisterTenantRequest): Promise<RegisterResponse> {
    // Check if tenant TIN already exists
    const existingTenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({ where: { tin: request.tin } });
    });

    if (existingTenant) {
      throw new ConflictException(`A business with TIN ${request.tin} is already registered`);
    }

    // Create tenant
    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.create({
        data: {
          name: request.tenantName,
          tin: request.tin,
          registeredAddress: request.registeredAddress as any,
          appAdapterKey: "mock",
          environment: "SANDBOX",
          rateLimitTier: "STANDARD",
        },
      });
    });

    // Hash password
    const passwordHash = await bcrypt.hash(request.password, BCRYPT_ROUNDS);

    // Create owner user
    const user = await this.userRepository.create({
      tenantId: tenant.id,
      email: request.email,
      passwordHash,
      firstName: request.firstName,
      lastName: request.lastName,
      isVerified: true,
      role: "OWNER",
    });

    // Issue access token
    const accessToken = await this.issueAccessToken(user, tenant.id);

    // Track activity
    this.activityService.track({
      tenantId: tenant.id,
      eventType: "TENANT_CREATED",
      actor: `user:${user.id}`,
      actorEmail: user.email,
      entityType: "Tenant",
      entityId: tenant.id,
      payload: {
        tenantName: tenant.name,
        tin: tenant.tin,
        registeredBy: user.email,
      },
    });

    this.activityService.track({
      tenantId: tenant.id,
      eventType: "USER_CREATED",
      actor: `user:${user.id}`,
      actorEmail: user.email,
      entityType: "User",
      entityId: user.id,
      payload: {
        email: user.email,
        role: "OWNER",
        registrationType: "self-serve",
      },
    });

    this.logger.log(`New tenant registered: ${tenant.name} [${tenant.tin}]`);

    return {
      tenant: { id: tenant.id, name: tenant.name, tin: tenant.tin },
      user: this.mapToResponse(user),
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL,
    };
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(
    tenantId: string,
    request: LoginRequest,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResponse> {
    // ── 1. Check lockout before any DB work ──────────────────────────────────
    const lockout = await this.redisService.getLockoutStatus(tenantId, request.email);
    if (lockout.locked) {
      const minutes = Math.ceil(lockout.retryAfterSecs / 60);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "ACCOUNT_LOCKED",
          message: `Account temporarily locked. Try again in ${minutes} minute(s).`,
          retryAfter: lockout.retryAfterSecs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── 2. User lookup ───────────────────────────────────────────────────────
    const user = await this.userRepository.findByEmail(tenantId, request.email);

    if (!user || !user.isActive) {
      this.activityService.track({
        tenantId,
        eventType: "USER_LOGIN_FAILED",
        actor: `email:${request.email}`,
        actorEmail: request.email,
        ipAddress,
        userAgent,
        payload: { email: request.email, reason: user ? "account_inactive" : "user_not_found" },
      });
      // Increment failures even for unknown emails to prevent enumeration via timing
      await this.redisService.recordLoginFailure(tenantId, request.email);
      throw new UnauthorizedException("Invalid email or password");
    }

    // ── 3. Password check ────────────────────────────────────────────────────
    const passwordValid = await bcrypt.compare(request.password, user.passwordHash);

    if (!passwordValid) {
      const { count, locked, retryAfterSecs } = await this.redisService.recordLoginFailure(
        tenantId,
        request.email,
      );

      this.activityService.track({
        tenantId,
        eventType: "USER_LOGIN_FAILED",
        actor: `user:${user.id}`,
        actorEmail: user.email,
        ipAddress,
        userAgent,
        payload: { email: request.email, reason: "invalid_password", failedAttempts: count },
      });

      if (locked) {
        const minutes = Math.ceil(retryAfterSecs / 60);
        // Fire-and-forget lockout notification email
        this.emailService.sendAccountLocked({
          to: user.email,
          firstName: user.firstName,
          lockoutMinutes: minutes,
        });
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: "ACCOUNT_LOCKED",
            message: `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`,
            retryAfter: retryAfterSecs,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new UnauthorizedException("Invalid email or password");
    }

    // ── 4. Success: clear failure counter ────────────────────────────────────
    await this.redisService.clearLoginFailures(tenantId, request.email);

    // ── 5. MFA check ──────────────────────────────────────────────────────────
    if ((user as any).mfaEnabled) {
      const mfaToken = this.mfaService.issueMfaToken(user.id, tenantId);
      this.activityService.track({
        tenantId,
        eventType: "USER_LOGIN",
        actor: `user:${user.id}`,
        actorEmail: user.email,
        ipAddress,
        userAgent,
        entityType: "User",
        entityId: user.id,
        payload: { email: user.email, mfaRequired: true },
      });
      return { mfaRequired: true, mfaToken, expiresIn: 300 };
    }

    // ── 6. No MFA: issue full JWT ────────────────────────────────────────────
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });
    const accessToken = await this.issueAccessToken(user, tenantId);

    const roles = (user as any).roles?.map((r: any) => r.role) ?? [];
    const isPrivileged = roles.includes("OWNER") || roles.includes("ADMIN");

    this.activityService.track({
      tenantId,
      eventType: "USER_LOGIN",
      actor: `user:${user.id}`,
      actorEmail: user.email,
      ipAddress,
      userAgent,
      entityType: "User",
      entityId: user.id,
      payload: { email: user.email },
    });

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL,
      tokenType: "Bearer",
      user: this.mapToResponse(user),
      mfaSetupRequired: isPrivileged ? true : undefined,
    };
  }

  // ── Complete MFA challenge (step 2 of login) ──────────────────────────────
  async completeMfaChallenge(
    mfaToken: string,
    code: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<MfaChallengeResponse> {
    const { userId, tenantId } = this.mfaService.verifyMfaToken(mfaToken);

    const valid = await this.mfaService.verifyCode(userId, code);
    if (!valid) {
      throw new UnauthorizedException("Invalid MFA code.");
    }

    const user = await this.userRepository.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Account not found or inactive.");
    }

    await this.userRepository.update(userId, { lastLoginAt: new Date() });
    const accessToken = await this.issueAccessToken(user, tenantId);

    this.activityService.track({
      tenantId,
      eventType: "USER_LOGIN",
      actor: `user:${userId}`,
      actorEmail: user.email,
      ipAddress,
      userAgent,
      entityType: "User",
      entityId: userId,
      payload: { email: user.email, mfaVerified: true },
    });

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL,
      tokenType: "Bearer",
      user: this.mapToResponse(user),
    };
  }

  // â"€â"€ Invite user â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async inviteUser(
    tenantId: string,
    invitedBy: string,
    request: InviteUserRequest,
    actorRoles: string[] = [],
  ): Promise<{ message: string; invitationToken: string }> {
    checkRole(actorRoles, "ADMIN");
    // Check if user already exists
    const existing = await this.userRepository.findByEmail(tenantId, request.email);
    if (existing) {
      throw new ConflictException(`User ${request.email} already exists in this organisation`);
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.userRepository.createInvitation({
      tenantId,
      email: request.email,
      role: request.role,
      token,
      invitedBy,
      expiresAt,
    });

    this.activityService.track({
      tenantId,
      eventType: "USER_CREATED",
      actor: invitedBy,
      entityType: "UserInvitation",
      payload: {
        email: request.email,
        role: request.role,
        invitedBy,
      },
    });

    this.logger.log(`Invitation sent to ${request.email} for tenant ${tenantId}`);

    // Look up inviter name and tenant name for the email
    this.prisma.asAdmin(async (tx) => {
      const [inviter, tenant] = await Promise.all([
        tx.user.findFirst({ where: { id: invitedBy.replace('user:', '') }, select: { firstName: true, lastName: true } }).catch(() => null),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      ]);
      const inviterName = inviter
        ? `${inviter.firstName} ${inviter.lastName}`.trim()
        : 'A team member';
      this.emailService.sendInvitation({
        to: request.email,
        invitedByName: inviterName,
        tenantName: tenant?.name ?? 'your organisation',
        role: request.role,
        token,
      });
    }).catch((err: any) => this.logger.error(`Failed to load invitation email context: ${err.message}`));

    return {
      message: `Invitation created for ${request.email}`,
      invitationToken: token,
    };
  }

  // â"€â"€ Accept invitation â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async acceptInvitation(
    request: AcceptInvitationRequest,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResponse> {
    const invitation = await this.userRepository.findInvitationByToken(request.token);

    if (!invitation) {
      throw new BadRequestException("Invalid or expired invitation token");
    }

    if (invitation.isRevoked || invitation.acceptedAt) {
      throw new BadRequestException("This invitation has already been used or revoked");
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException("This invitation has expired");
    }

    const passwordHash = await bcrypt.hash(request.password, BCRYPT_ROUNDS);

    const user = await this.userRepository.create({
      tenantId: invitation.tenantId,
      email: invitation.email,
      passwordHash,
      firstName: request.firstName ?? invitation.email.split("@")[0],
      lastName: request.lastName ?? "",
      isVerified: true,
      role: invitation.role,
    });

    await this.userRepository.acceptInvitation(request.token);

    const accessToken = await this.issueAccessToken(user, invitation.tenantId);

    this.activityService.track({
      tenantId: invitation.tenantId,
      eventType: "USER_CREATED",
      actor: `user:${user.id}`,
      actorEmail: user.email,
      entityType: "User",
      entityId: user.id,
      payload: {
        email: user.email,
        role: invitation.role,
        registrationType: "invitation",
      },
    });

    // Record consent (NDPA 2023) — fire-and-forget
    Promise.all([
      this.consentService.record({
        email: user.email,
        userId: user.id,
        tenantId: invitation.tenantId,
        consentType: 'TERMS_AND_PRIVACY',
        ipAddress,
        userAgent,
      }),
      this.consentService.record({
        email: user.email,
        userId: user.id,
        tenantId: invitation.tenantId,
        consentType: 'NDPR_DATA_PROCESSING',
        ipAddress,
        userAgent,
      }),
    ]).catch((err: any) =>
      this.logger.error(`Failed to record consent: ${err.message}`),
    );

    // Send welcome email (fire-and-forget; tenant name resolved async)
    this.prisma.asAdmin(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: invitation.tenantId }, select: { name: true } });
      this.emailService.sendWelcome({
        to: user.email,
        firstName: user.firstName,
        tenantName: tenant?.name ?? 'your organisation',
        role: invitation.role,
      });
    }).catch((err: any) => this.logger.error(`Failed to send welcome email: ${err.message}`));

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL,
      tokenType: "Bearer",
      user: this.mapToResponse(user),
    };
  }

  // â"€â"€ Forgot password â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async forgotPassword(
    tenantId: string,
    request: ForgotPasswordRequest,
  ): Promise<{ message: string; resetToken?: string }> {
    const user = await this.userRepository.findByEmail(tenantId, request.email);

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: "If that email exists, a reset link has been sent" };
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);

    await this.userRepository.createPasswordResetToken({
      userId: user.id,
      token,
      expiresAt,
    });

    this.activityService.track({
      tenantId,
      eventType: "PASSWORD_RESET",
      actor: `user:${user.id}`,
      actorEmail: user.email,
      entityType: "User",
      entityId: user.id,
      payload: { email: user.email, action: "requested" },
    });

    this.emailService.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      token,
    });

    return { message: "If that email exists, a reset link has been sent" };
  }

  // â"€â"€ Reset password â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async resetPassword(request: ResetPasswordRequest): Promise<{ message: string }> {
    const resetToken = await this.userRepository.findPasswordResetToken(request.token);

    if (!resetToken || resetToken.usedAt || new Date() > resetToken.expiresAt) {
      throw new BadRequestException("Invalid or expired reset token");
    }

    const passwordHash = await bcrypt.hash(request.newPassword, BCRYPT_ROUNDS);
    await this.userRepository.update(resetToken.userId, { passwordHash });
    await this.userRepository.markPasswordResetTokenUsed(request.token);

    return { message: "Password reset successfully" };
  }

  // â"€â"€ Change password â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async changePassword(
    userId: string,
    request: ChangePasswordRequest,
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const valid = await bcrypt.compare(request.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Current password is incorrect");

    const passwordHash = await bcrypt.hash(request.newPassword, BCRYPT_ROUNDS);
    await this.userRepository.update(userId, { passwordHash });

    return { message: "Password changed successfully" };
  }

  // â"€â"€ List users â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async listUsers(tenantId: string): Promise<UserListResponse> {
    const users = await this.userRepository.findByTenantId(tenantId);
    return {
      data: users.map((u: any) => this.mapToResponse(u)),
      total: users.length,
    };
  }

  // â"€â"€ Get user â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async getUser(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundException("User not found");
    return this.mapToResponse(user);
  }

  // â"€â"€ Update user â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async updateUser(id: string, request: UpdateUserRequest): Promise<UserResponse> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundException("User not found");

    const updated = await this.userRepository.update(id, request);
    return this.mapToResponse(updated);
  }

  // â"€â"€ Assign role â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async assignRole(
    userId: string,
    tenantId: string,
    role: UserRoleType,
    actorRoles: string[] = [],
  ): Promise<UserResponse> {
    checkRole(actorRoles, "OWNER");
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    await this.userRepository.addRole(userId, tenantId, role);
    const updated = await this.userRepository.findById(userId);
    return this.mapToResponse(updated!);
  }

  // â"€â"€ Remove role â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async removeRole(userId: string, role: UserRoleType, actorRoles: string[] = []): Promise<UserResponse> {
    checkRole(actorRoles, "OWNER");
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    await this.userRepository.removeRole(userId, role);
    const updated = await this.userRepository.findById(userId);
    return this.mapToResponse(updated!);
  }

  // â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  private async issueAccessToken(user: any, tenantId: string): Promise<string> {
    const secret = process.env.JWT_SECRET ?? "billinx-dev-secret-key-change-in-production";
    const roles = user.roles?.map((r: any) => r.role) ?? [];
    const primaryRole = roles[0] ?? "VIEWER";

    return jwt.sign(
      {
        sub: user.id,
        tenantId,
        email: user.email,
        roles,
        role: primaryRole,
        environment: "PRODUCTION",
        tier: "STANDARD",
      },
      secret,
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  private mapToResponse(user: any): UserResponse {
    const roles: UserRoleType[] = user.roles?.map((r: any) => r.role as UserRoleType) ?? [];
    const permissions = [
      ...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? [])),
    ];

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      isActive: user.isActive,
      isVerified: user.isVerified,
      mfaEnabled: user.mfaEnabled ?? false,
      roles,
      permissions,
      lastLoginAt: user.lastLoginAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }
  async requestAccess(
    request: {
      companyName: string;
      tin: string;
      contactName: string;
      email: string;
      phone?: string;
      estimatedVolume?: string;
      useCase?: string;
    },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ message: string; referenceId: string }> {
    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.findFirst({
        where: { email: request.email, status: "PENDING" },
      });
    });
    if (existing) {
      return {
        message: "Your request is already under review. We will contact you shortly.",
        referenceId: existing.id,
      };
    }
    const accessRequest = await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.create({
        data: {
          companyName: request.companyName,
          tin: request.tin,
          contactName: request.contactName,
          email: request.email,
          phone: request.phone ?? null,
          estimatedVolume: request.estimatedVolume ?? null,
          useCase: request.useCase ?? null,
          status: "PENDING",
        },
      });
    });
    this.logger.log(`Access request received from ${request.companyName} (${request.email})`);

    this.emailService.sendAccessRequestReceived({
      to: request.email,
      contactName: request.contactName,
      companyName: request.companyName,
      referenceId: accessRequest.id,
    });

    // Record BUSINESS_AUTHORISATION consent — fire-and-forget
    this.consentService
      .record({
        email: request.email,
        consentType: 'BUSINESS_AUTHORISATION',
        ipAddress,
        userAgent,
        metadata: { referenceId: accessRequest.id },
      })
      .catch((err: any) =>
        this.logger.error(`Failed to record consent: ${err.message}`),
      );

    return {
      message: "Thank you for your interest in Billinx. We will review your request and contact you within 24 hours.",
      referenceId: accessRequest.id,
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

  async approveAccessRequest(id: string, reviewedBy: string, reviewNote?: string): Promise<{ message: string }> {
    const request = await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.findUnique({ where: { id } });
    });
    if (!request) throw new NotFoundException(`Access request ${id} not found`);
    await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.update({
        where: { id },
        data: { status: "APPROVED", reviewedBy, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
      });
    });
    this.logger.log(`Access request ${id} approved for ${request.companyName}`);
    return { message: `Access request for ${request.companyName} approved. Create their tenant and send invitation to ${request.email}.` };
  }

  async rejectAccessRequest(id: string, reviewedBy: string, reviewNote?: string): Promise<{ message: string }> {
    const request = await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.findUnique({ where: { id } });
    });
    if (!request) throw new NotFoundException(`Access request ${id} not found`);
    await this.prisma.asAdmin(async (tx) => {
      return tx.accessRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedBy, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
      });
    });
    return { message: `Access request for ${request.companyName} rejected.` };
  }

  async listMyConsentRecords(userId: string) {
    return this.consentService.listByUser(userId);
  }

  async requestErasure(userId: string, tenantId: string, email: string) {
    return this.consentService.requestErasure({ userId, tenantId, email });
  }
}