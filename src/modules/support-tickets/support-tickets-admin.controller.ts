import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { SupportTicketService } from './support-ticket.service';
import { UpdateSupportTicketStatusDto } from './dto/update-support-ticket-status.dto';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { SupportTicketStatus } from '../../../packages/types/support-tickets';

@ApiTags('Admin')
@Controller('v1/admin/support-tickets')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class SupportTicketsAdminController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: list support tickets (error reports)' })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'tenantId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List support tickets' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async list(
    @Query('status') status?: SupportTicketStatus,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.supportTicketService.listTickets({
      status,
      tenantId,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Admin: support ticket detail, with a freshly-generated signed screenshot URL',
  })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiResponse({ status: 200, description: 'Support ticket detail' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async get(@Param('id') id: string) {
    return this.supportTicketService.getTicket(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: update a support ticket status' })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketStatusDto,
  ) {
    return this.supportTicketService.updateStatus(id, dto.status);
  }
}
