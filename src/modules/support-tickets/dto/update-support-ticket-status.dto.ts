import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SupportTicketStatus } from '../../../../packages/types/support-tickets';

const STATUSES: SupportTicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

export class UpdateSupportTicketStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  status!: SupportTicketStatus;
}
