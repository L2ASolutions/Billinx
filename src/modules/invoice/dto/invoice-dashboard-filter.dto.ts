import { IsOptional, IsString, IsBoolean, IsInt, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceDashboardFilterDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Invoice state-machine status',
    example: 'ACCEPTED',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Payment status filter',
    example: 'PAID',
    enum: ['PENDING', 'PAID', 'PARTIAL'],
  })
  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @ApiPropertyOptional({
    description: 'Free-text search across invoice number, buyer name, IRN',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by buyer TIN' })
  @IsOptional()
  @IsString()
  buyerTin?: string;

  @ApiPropertyOptional({ description: 'Filter by seller TIN' })
  @IsOptional()
  @IsString()
  sellerTin?: string;

  @ApiPropertyOptional({ description: 'Filter by NRS invoice type code' })
  @IsOptional()
  @IsString()
  invoiceTypeCode?: string;

  @ApiPropertyOptional({
    description: 'Start of issue-date range (ISO 8601)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of issue-date range (ISO 8601)',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Only return invoices past their due date and unpaid',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isOverdue?: boolean;

  @ApiPropertyOptional({
    description: 'Only return invoices eligible for buyer payment initiation',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  forPayments?: boolean;
}
