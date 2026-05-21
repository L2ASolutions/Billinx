import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ReminderService, CreateReminderRuleDto, UpdateReminderRuleDto } from './services/reminder.service';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('Reminder Rules')
@Controller('v1/reminder-rules')
@UseGuards(JwtGuard)
@ApiBearerAuth()
export class ReminderController {
  constructor(private readonly reminderService: ReminderService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Get()
  @ApiOperation({ summary: 'List reminder rules for the tenant' })
  async listRules(@Req() req: Request) {
    const { tenantId } = this.getCtx(req);
    return this.reminderService.listRules(tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom reminder rule' })
  async createRule(@Req() req: Request, @Body() body: CreateReminderRuleDto) {
    const { tenantId } = this.getCtx(req);
    return this.reminderService.createRule(tenantId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a reminder rule (toggle active, change days, etc.)' })
  async updateRule(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateReminderRuleDto,
  ) {
    const { tenantId } = this.getCtx(req);
    return this.reminderService.updateRule(tenantId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a reminder rule' })
  async deleteRule(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = this.getCtx(req);
    await this.reminderService.deleteRule(tenantId, id);
  }
}
