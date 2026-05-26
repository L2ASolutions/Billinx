import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { UserService } from './services/user.service';
import { MfaService } from './services/mfa.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { AuthRateLimitGuard } from '../../shared/guards/auth-rate-limit.guard';
import { getRequestContext } from '../../shared/context/request-context';
import {
  RegisterTenantRequest,
  InviteUserRequest,
  AcceptInvitationRequest,
  ChangePasswordRequest,
  UpdateUserRequest,
  UserRoleType,
} from '../../../packages/types/user';
// BUG-019: Typed DTOs so the global ValidationPipe runs class-validator rules
// on these security-critical endpoints.
import {
  LoginDto,
  RegisterDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@ApiTags('Users')
@Controller('v1')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly mfaService: MfaService,
  ) {}

  // ── Public endpoints (no auth required) ───────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: 'Self-serve tenant and owner registration' })
  async register(@Body() body: RegisterDto) {
    return this.userService.registerTenant(
      body as unknown as RegisterTenantRequest,
    );
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() body: LoginDto, @Req() req: Request) {
    let tenantId = body.tenantId;
    if (!tenantId) {
      const found = await this.userService.findUserByEmail(body.email);
      if (!found) {
        throw new UnauthorizedException('Invalid email or password');
      }
      tenantId = found.tenantId;
    }
    return this.userService.login(
      tenantId,
      body,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('auth/forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    // BUG-014: frontend sends only {email}; look up tenantId if not supplied.
    // Return generic success regardless to prevent user-enumeration.
    let tenantId = body.tenantId;
    if (!tenantId && body.email) {
      const found = await this.userService.findUserByEmail(body.email);
      if (!found) {
        return {
          message: 'If that email is registered, a reset link has been sent.',
        };
      }
      tenantId = found.tenantId;
    }
    if (!tenantId) {
      return {
        message: 'If that email is registered, a reset link has been sent.',
      };
    }
    return this.userService.forgotPassword(tenantId, body);
  }

  @Post('auth/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using reset token' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.userService.resetPassword(body);
  }

  @Post('auth/accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept invitation and set password' })
  async acceptInvitation(
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    return this.userService.acceptInvitation(
      body as AcceptInvitationRequest,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('auth/mfa/challenge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Complete MFA step-2 login with OTP or backup code',
  })
  async mfaChallenge(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.userService.completeMfaChallenge(
      body.mfaToken,
      body.code,
      req.ip,
      req.headers['user-agent'],
    );
  }

  // ── MFA management (JWT required) ────────────────────────────────────────────

  @Post('auth/mfa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Begin MFA setup — returns QR code and manual entry key',
  })
  async setupMfa() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    const user = await this.userService.getUser(userId);
    return this.mfaService.setupMfa(userId, user.email);
  }

  @Post('auth/mfa/verify-setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify first OTP code to confirm setup and enable MFA',
  })
  async verifyMfaSetup(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    await this.mfaService.verifySetupAndEnable(userId, body.code);
    return { message: 'MFA has been enabled on your account.' };
  }

  @Post('auth/mfa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Disable MFA — requires current OTP or backup code',
  })
  async disableMfa(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    await this.mfaService.disableMfa(userId, body.code);
    return { message: 'MFA has been disabled on your account.' };
  }

  @Get('auth/mfa/backup-codes')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate new set of 8 backup codes (invalidates previous set)',
  })
  async generateBackupCodes() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    const codes = await this.mfaService.generateBackupCodes(userId);
    return {
      codes,
      message:
        'Store these codes safely — they can each only be used once. This replaces any previous backup codes.',
    };
  }

  @Get('auth/mfa/status')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get MFA status for the current user' })
  async getMfaStatus() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    return this.mfaService.getMfaStatus(userId);
  }

  // ── Authenticated endpoints (JWT required) ────────────────────────────────

  @Get('users/me')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    return this.userService.getUser(userId);
  }

  @Patch('users/me')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    return this.userService.updateUser(userId, body as UpdateUserRequest);
  }

  @Post('users/me/change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change current user password' })
  async changePassword(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    return this.userService.changePassword(
      userId,
      body as ChangePasswordRequest,
    );
  }

  @Get('users')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all users in tenant' })
  async listUsers() {
    const ctx = getRequestContext();
    return this.userService.listUsers(ctx.tenantId);
  }

  @Get('users/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user by ID' })
  async getUser(@Param('id') id: string) {
    return this.userService.getUser(id);
  }

  @Patch('users/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user' })
  async updateUser(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.userService.updateUser(id, body as UpdateUserRequest);
  }

  @Post('users/invite')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite a new user to the tenant' })
  async inviteUser(@Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    return this.userService.inviteUser(
      ctx.tenantId,
      ctx.actor,
      body as InviteUserRequest,
    );
  }

  @Post('users/:id/roles')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign role to user' })
  async assignRole(@Param('id') id: string, @Body() body: Record<string, any>) {
    const ctx = getRequestContext();
    return this.userService.assignRole(
      id,
      ctx.tenantId,
      body.role as UserRoleType,
    );
  }

  @Delete('users/:id/roles/:role')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove role from user' })
  async removeRole(@Param('id') id: string, @Param('role') role: string) {
    return this.userService.removeRole(id, role as UserRoleType);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate (soft-delete) a user from the tenant' })
  async deactivateUser(@Param('id') id: string) {
    const ctx = getRequestContext();
    await this.userService.deactivateUser(id, ctx.tenantId);
  }

  // ── Public: request access ────────────────────────────────────────────────
  @Post('request-access')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request access to Billinx platform' })
  async requestAccess(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.userService.requestAccess(
      body as any,
      req.ip,
      req.headers['user-agent'],
    );
  }

  // ── Consent records (JWT required) ───────────────────────────────────────
  @Get('users/me/consent-records')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get consent records for the current user (NDPA 2023)',
  })
  async getMyConsentRecords() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    return this.userService.listMyConsentRecords(userId);
  }

  // ── Right to erasure (JWT required) ──────────────────────────────────────
  @Post('users/me/request-erasure')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit a right-to-erasure request under NDPA 2023',
    description:
      'Flags the account for PII erasure review. Does not delete immediately. ' +
      'Admin approval required. Invoice records are not affected.',
  })
  async requestErasure() {
    const ctx = getRequestContext();
    const userId = ctx.actor.replace('user:', '');
    const user = await this.userService.getUser(userId);
    return this.userService.requestErasure(userId, ctx.tenantId, user.email);
  }
}
