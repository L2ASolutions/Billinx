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
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from "@nestjs/swagger";
import { Request } from "express";
import { UserService } from "./services/user.service";
import { ApiKeyGuard } from "../identity/guards/api-key.guard";
import { JwtGuard } from "../identity/guards/jwt.guard";
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
  constructor(private readonly userService: UserService) {}

  // ── Public endpoints (no auth required) ───────────────────────────────────

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Self-serve tenant and owner registration" })
  async register(@Body() body: Record<string, any>) {
    return this.userService.registerTenant(body as RegisterTenantRequest);
  }

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
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
}