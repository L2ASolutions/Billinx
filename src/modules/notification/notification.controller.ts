import { Controller, Get, Patch, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('v1/notifications')
@UseGuards(JwtGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  private ctx(req: Request) {
    return (req as any)._billinxContext as { tenantId: string; actor: string };
  }

  @Get()
  @ApiOperation({
    summary: 'List 20 most recent notifications for the current user',
  })
  list(@Req() req: Request) {
    const { tenantId, actor } = this.ctx(req);
    return this.notificationService.findForUser(tenantId, actor);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@Req() req: Request) {
    const { tenantId, actor } = this.ctx(req);
    await this.notificationService.markAllRead(tenantId, actor);
    return { ok: true };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async markRead(@Param('id') id: string, @Req() req: Request) {
    const { tenantId, actor } = this.ctx(req);
    await this.notificationService.markRead(tenantId, actor, id);
    return { ok: true };
  }
}
