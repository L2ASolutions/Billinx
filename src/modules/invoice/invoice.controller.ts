import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  Req,
  Res,
  Header,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiProduces,
  ApiHeader,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { InvoiceService } from "./services/invoice.service";
import { ExportService } from "../export/export.service";
import { ApiKeyGuard } from "../identity/guards/api-key.guard";
import { JwtGuard } from "../identity/guards/jwt.guard";
import {
  InvoiceFilterParams,
  InvoiceStatus,
  InvoiceTypeCode,
} from "../../../packages/types/invoice";

@ApiTags("Invoices")
@Controller("v1/invoices")
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly exportService: ExportService,
  ) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  // ---------------------------------------------------------------------------
  // JSON routes
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Submit invoice for FIRS compliance" })
  async createInvoice(
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.createInvoice(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body as any,
    );
  }

  @Post("validate")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Validate invoice without submitting to FIRS" })
  async validateInvoice(@Body() body: Record<string, any>) {
    return this.invoiceService.validateInvoice(body);
  }

  // ---------------------------------------------------------------------------
  // XML routes (static segments — must precede :id param routes)
  // ---------------------------------------------------------------------------

  @Post("from-xml")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create invoice from NRS-compliant XML body" })
  @ApiConsumes("application/xml")
  async createInvoiceFromXml(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (typeof body !== "string" || !body.trim()) {
      throw new BadRequestException("Request body must be a non-empty XML string");
    }
    const ctx = this.getCtx(req);
    return this.invoiceService.createInvoiceFromXml(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body,
    );
  }

  // ---------------------------------------------------------------------------
  // List / stats
  // ---------------------------------------------------------------------------

  @Get()
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List invoices for authenticated tenant" })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "invoiceTypeCode", required: false })
  @ApiQuery({ name: "sellerTin", required: false })
  @ApiQuery({ name: "buyerTin", required: false })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async listInvoices(
    @Req() req: Request,
    @Query("status") status?: InvoiceStatus,
    @Query("invoiceTypeCode") invoiceTypeCode?: InvoiceTypeCode,
    @Query("sellerTin") sellerTin?: string,
    @Query("buyerTin") buyerTin?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    const ctx = this.getCtx(req);
    const filters: InvoiceFilterParams = {
      status,
      invoiceTypeCode,
      sellerTin,
      buyerTin,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    };
    return this.invoiceService.listInvoices(ctx.tenantId, filters);
  }

  @Get("stats")
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get invoice statistics for tenant" })
  async getInvoiceStats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStats(ctx.tenantId);
  }

  // ---------------------------------------------------------------------------
  // Export routes (static segments — must precede :id param routes)
  // ---------------------------------------------------------------------------

  @Get("export/csv")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Export invoices as CSV for compliance reporting" })
  @ApiQuery({ name: "startDate", required: true })
  @ApiQuery({ name: "endDate", required: true })
  async exportCSV(
    @Req() req: Request,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    const ctx = this.getCtx(req);
    if (!startDate || !endDate) {
      throw new BadRequestException("startDate and endDate are required");
    }
    const csv = await this.exportService.exportInvoicesCSV(
      ctx.tenantId,
      startDate,
      endDate,
    );
    return csv;
  }

  @Get("export/json")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Export invoices as JSON in NRS canonical format" })
  @ApiQuery({ name: "startDate", required: true })
  @ApiQuery({ name: "endDate", required: true })
  async exportJSON(
    @Req() req: Request,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    const ctx = this.getCtx(req);
    if (!startDate || !endDate) {
      throw new BadRequestException("startDate and endDate are required");
    }
    return this.exportService.exportInvoicesJSON(
      ctx.tenantId,
      startDate,
      endDate,
    );
  }

  @Get("export/monthly")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get monthly invoice summary report" })
  @ApiQuery({ name: "year", required: true, type: Number })
  @ApiQuery({ name: "month", required: true, type: Number })
  async exportMonthly(
    @Req() req: Request,
    @Query("year") year: string,
    @Query("month") month: string,
  ) {
    const ctx = this.getCtx(req);
    if (!year || !month) {
      throw new BadRequestException("year and month are required");
    }
    return this.exportService.exportMonthlyReport(
      ctx.tenantId,
      Number(year),
      Number(month),
    );
  }

  // ---------------------------------------------------------------------------
  // Single-invoice routes — :id param
  // ---------------------------------------------------------------------------

  @Get(":id")
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get invoice by ID (JSON or XML via Accept header)",
  })
  @ApiHeader({
    name: "Accept",
    required: false,
    description: "application/json (default) or application/xml",
  })
  @ApiProduces("application/json", "application/xml")
  async getInvoice(
    @Param("id") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers("accept") accept?: string,
  ) {
    const ctx = this.getCtx(req);
    if (accept?.includes("application/xml")) {
      const xml = await this.invoiceService.exportAsXml(id, ctx.tenantId);
      res.setHeader("Content-Type", "application/xml");
      return xml;
    }
    return this.invoiceService.getInvoice(id, ctx.tenantId);
  }

  @Get(":id/xml")
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get invoice as NRS-compliant XML" })
  @Header("Content-Type", "application/xml")
  @ApiProduces("application/xml")
  async getInvoiceXml(@Param("id") id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.exportAsXml(id, ctx.tenantId);
  }

  @Get(":id/status")
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get invoice lifecycle status and history" })
  async getInvoiceStatus(@Param("id") id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStatus(id, ctx.tenantId);
  }

  @Patch(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Cancel an accepted invoice" })
  async cancelInvoice(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.cancelInvoice(
      id,
      ctx.tenantId,
      ctx.actor,
      body as any,
    );
  }

  // ---------------------------------------------------------------------------
  // Dashboard routes (JWT auth)
  // ---------------------------------------------------------------------------

  @Post("dashboard")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create invoice from dashboard (JWT auth)" })
  async createInvoiceDashboard(
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.createInvoice(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body as any,
    );
  }

  @Get("dashboard/list")
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List invoices from dashboard (JWT auth)" })
  async listInvoicesDashboard(
    @Req() req: Request,
    @Query("status") status?: InvoiceStatus,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.listInvoices(ctx.tenantId, {
      status,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }
}
