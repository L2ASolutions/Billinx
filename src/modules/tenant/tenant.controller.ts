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
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiQuery,
} from "@nestjs/swagger";
import { TenantService } from "./services/tenant.service";
import { AdminKeyGuard } from "../identity/guards/admin-key.guard";

@ApiTags("Tenants")
@Controller("v1/tenants")
@UseGuards(AdminKeyGuard)
export class TenantController {
  private readonly logger = new Logger(TenantController.name);

  constructor(private readonly tenantService: TenantService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Provision a new tenant" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  async createTenant(@Body() body: Record<string, any>) {
    return this.tenantService.createTenant(body as any);
  }

  @Get()
  @ApiOperation({ summary: "List all tenants" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async listTenants(
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.tenantService.listTenants(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get tenant by ID" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  async getTenant(@Param("id") id: string) {
    return this.tenantService.getTenant(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update tenant configuration" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  async updateTenant(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.tenantService.updateTenant(id, body as any);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deactivate a tenant" })
  @ApiHeader({ name: "X-Admin-Key", required: true })
  async deactivateTenant(@Param("id") id: string) {
    await this.tenantService.deactivateTenant(id);
  }
}