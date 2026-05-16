import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
} from "@nestjs/swagger";
import { Request } from "express";
import { UserService } from "./services/user.service";
import { MfaService } from "./services/mfa.service";
import { ApiKeyGuard } from "../identity/guards/api-key.guard";
import { JwtGuard } from "../identity/guards/jwt.guard";
import { AdminKeyGuard } from "../identity/guards/admin-key.guard";
import { AuthRateLimitGuard } from "../../shared/guards/auth-rate-limit.guard";
import { getRequestContext } from "../../shared/context/request-context";
import {
  RegisterTenantRequest,
  InviteUserRequest,
  AcceptInvitationRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  UpdateUserRequest,
  AssignRoleRequest,
  UserRoleType,
} from "../../../packages/types/user";

@ApiTags("Users")
@Controller("v1")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly mfaService: MfaService,
  ) {}

  // ── Public endpoints (no auth required) ───────────────────────────────────

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: "Self-serve tenant and owner registration" })
  async register(@Body() body: Record<string, any>) {
    return this.userService.registerTenant(body as RegisterTenantRequest);
  }

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: "Login with email and password" })
  async login(@Body() body: Record<string, any>, @Req() req: Request) {
    const tenantId = body.tenantId;
    if (!tenantId) {
      return { error: "tenantId is required" };
    }
    return this.userService.login(
      tenantId,
      body as LoginRequest,
      req.ip,
      req.headers["user-agent"],
    );
  }

  @Post("auth/forgot-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: "Request password reset email" })
  async forgotPassword(@Body() body: Record<string, any>) {
    return this.userService.forgotPassword(
      body.tenantId,
      body as ForgotPasswordRequest,
    );
  }

  @Post("auth/reset-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset password using reset token" })
  async resetPassword(@Body() body: Record<string, any>) {
    return this.userService.resetPassword(body as ResetPasswordRequest);
  }

  @Post("auth/accept-invitation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept invitation and set password" })
  async acceptInvitation(@Body() body: Record<string, any>) {
    return this.userService.acceptInvitation(body as AcceptInvitationRequest);
  }

  @Post("auth/mfa/challenge")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: "Complete MFA step-2 login with OTP or backup code" })
  async mfaChallenge(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.userService.completeMfaChallenge(
      body.mfaToken,
      body.code,
      req.ip,
      req.headers["user-agent"] as string,
    );
  }

  // ── MFA management (JWT required) ────────────────────────────────────────────

  @Post("auth/mfa/setup")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Begin MFA setup — returns QR code and manual entry key" })
  async setupMfa() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    const user = await this.userService.getUser(userId);
    return this.mfaService.setupMfa(userId, user.email);
  }

  @Post("auth/mfa/verify-setup")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Verify first OTP code to confirm setup and enable MFA" })
  async verifyMfaSetup(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    await this.mfaService.verifySetupAndEnable(userId, body.code);
    return { message: "MFA has been enabled on your account." };
  }

  @Post("auth/mfa/disable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Disable MFA — requires current OTP or backup code" })
  async disableMfa(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    await this.mfaService.disableMfa(userId, body.code);
    return { message: "MFA has been disabled on your account." };
  }

  @Get("auth/mfa/backup-codes")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Generate new set of 8 backup codes (invalidates previous set)" })
  async generateBackupCodes() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    const codes = await this.mfaService.generateBackupCodes(userId);
    return {
      codes,
      message: "Store these codes safely — they can each only be used once. This replaces any previous backup codes.",
    };
  }

  @Get("auth/mfa/status")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get MFA status for the current user" })
  async getMfaStatus() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    return this.mfaService.getMfaStatus(userId);
  }

  // ── Authenticated endpoints (JWT required) ────────────────────────────────

  @Get("users/me")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user profile" })
  async getMe() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    return this.userService.getUser(userId);
  }

  @Patch("users/me")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update current user profile" })
  async updateMe(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    return this.userService.updateUser(userId, body as UpdateUserRequest);
  }

  @Post("users/me/change-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change current user password" })
  async changePassword(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace("user:", "");
    return this.userService.changePassword(userId, body as ChangePasswordRequest);
  }

  @Get("users")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all users in tenant" })
  async listUsers() {
    const ctx = getRequestContext();
    return this.userService.listUsers(ctx.tenantId);
  }

  @Get("users/:id")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get user by ID" })
  async getUser(@Param("id") id: string) {
    return this.userService.getUser(id);
  }

  @Patch("users/:id")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user" })
  async updateUser(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.userService.updateUser(id, body as UpdateUserRequest);
  }

  @Post("users/invite")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Invite a new user to the tenant" })
  async inviteUser(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    return this.userService.inviteUser(
      ctx.tenantId,
      ctx.actor,
      body as InviteUserRequest,
    );
  }

  @Post("users/:id/roles")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Assign role to user" })
  async assignRole(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
  ) {
    const ctx = getRequestContext();
    return this.userService.assignRole(
      id,
      ctx.tenantId,
      body.role as UserRoleType,
    );
  }

  @Delete("users/:id/roles/:role")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove role from user" })
  async removeRole(
    @Param("id") id: string,
    @Param("role") role: string,
  ) {
    return this.userService.removeRole(id, role as UserRoleType);
  }
// ── Public: request access ────────────────────────────────────────────────
  @Post("request-access")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Request access to Billinx platform" })
  async requestAccess(@Body() body: Record<string, any>) {
    return this.userService.requestAccess(body as any);
  }

  // ── Admin: list access requests ───────────────────────────────────────────
  @Get("admin/access-requests")
  @UseGuards(AdminKeyGuard)
  @ApiOperation({ summary: "Admin: list all access requests" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiQuery({ name: "status", required: false })
  async listAccessRequests(@Query("status") status?: string) {
    return this.userService.listAccessRequests(status);
  }

  @Patch("admin/access-requests/:id/approve")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  @ApiOperation({ summary: "Admin: approve an access request" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  async approveAccessRequest(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.userService.approveAccessRequest(
      id,
      body.reviewedBy ?? "admin",
      body.reviewNote,
    );
  }

  @Patch("admin/access-requests/:id/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  @ApiOperation({ summary: "Admin: reject an access request" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  async rejectAccessRequest(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.userService.rejectAccessRequest(
      id,
      body.reviewedBy ?? "admin",
      body.reviewNote,
    );
  }
}