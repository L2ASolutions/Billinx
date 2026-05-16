import {
  Controller,
  Post,
  Get,
  Patch,
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
import { AdminService } from "./services/admin.service";
import { AdminKeyGuard } from "../identity/guards/admin-key.guard";
import { AdminJwtGuard } from "./guards/admin-jwt.guard";
import {
  AdminLoginRequest,
  CreateAdminUserRequest,
} from "../../../packages/types/admin";

@ApiTags("Admin")
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private getAdminCtx(req: Request): any {
    return (req as any)._adminContext;
  }

  @Post("users")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({ summary: "Create an admin user (L2A Solutions staff)" })
  async createAdminUser(@Body() body: Record<string, any>) {
    return this.adminService.createAdminUser(body as CreateAdminUserRequest);
  }

  @Get("users")
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all admin users" })
  async listAdminUsers() {
    return this.adminService.listAdminUsers();
  }

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Admin login with email and password" })
  async login(@Body() body: Record<string, any>) {
    return this.adminService.login(body as AdminLoginRequest);
  }

  @Get("dashboard")
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get platform-wide dashboard statistics" })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get("tenants")
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all tenants on the platform" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async listTenants(
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.adminService.listTenants(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get("tenants/:id")
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get full detail for a specific tenant" })
  async getTenantDetail(@Param("id") id: string) {
    return this.adminService.getTenantDetail(id);
  }

  @Get("access-requests")
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all access requests" })
  @ApiQuery({ name: "status", required: false })
  async listAccessRequests(@Query("status") status?: string) {
    return this.adminService.listAccessRequests(status);
  }

  @Post("access-requests/:id/provision")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Approve request and auto-provision tenant" })
  async approveAndProvision(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getAdminCtx(req);
    return this.adminService.approveAndProvision(id, ctx.adminId, {
      appAdapterKey: body.appAdapterKey,
      environment: body.environment,
      reviewNote: body.reviewNote,
    });
  }

  @Post("users/unlock")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Unlock a locked user account" })
  async unlockAccount(@Body() body: Record<string, any>) {
    return this.adminService.unlockAccount(body.tenantId, body.email);
  }

  @Patch("access-requests/:id/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Reject an access request" })
  async rejectAccessRequest(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getAdminCtx(req);
    return this.adminService.rejectAccessRequest(
      id,
      ctx.adminId,
      body.reviewNote,
    );
  }
}