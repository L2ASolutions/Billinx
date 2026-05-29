import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IncomingInvoiceItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  lineAmount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hsnCode?: string;
}

export class CreateIncomingInvoiceDto {
  @ApiProperty({ example: 'Acme Supplies Ltd' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  supplierName!: string;

  @ApiProperty({ example: '12345678-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  supplierTin!: string;

  @ApiProperty({ example: 'INV-2026-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  invoiceNumber!: string;

  @ApiProperty({ example: 500000 })
  @IsNumber()
  @IsPositive()
  invoiceAmount!: number;

  @ApiProperty({ example: 37500 })
  @IsNumber()
  @Min(0)
  vatAmount!: number;

  @ApiProperty({ example: '2026-05-01T00:00:00.000Z' })
  @IsDateString()
  invoiceDate!: string;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceReference?: string;

  @ApiPropertyOptional({ type: [IncomingInvoiceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncomingInvoiceItemDto)
  items?: IncomingInvoiceItemDto[];
}

export class RejectIncomingInvoiceDto {
  @ApiProperty({ example: 'Invalid TIN on invoice' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class MarkPaidIncomingInvoiceDto {
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'TRX-2026-001' })
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @ApiProperty({ example: 'BANK_TRANSFER' })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({ example: '2026-05-29T10:00:00.000Z' })
  @IsDateString()
  paidAt!: string;
}
