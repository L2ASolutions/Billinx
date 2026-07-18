import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsDateString,
  IsArray,
  IsBoolean,
  ValidateNested,
  Min,
  Max,
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

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  whtApplicable?: boolean;

  @ApiPropertyOptional({
    example: 5,
    description: 'WHT rate percentage (default 5)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  whtRate?: number;

  @ApiPropertyOptional({ type: [IncomingInvoiceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncomingInvoiceItemDto)
  items?: IncomingInvoiceItemDto[];

  @ApiPropertyOptional({ example: 'supplier@company.com' })
  @IsOptional()
  @IsString()
  supplierEmail?: string;

  @ApiPropertyOptional({ example: 'GTBank' })
  @IsOptional()
  @IsString()
  supplierBankName?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @IsString()
  supplierBankAccount?: string;

  @ApiPropertyOptional({ example: 'Acme Supplies Ltd' })
  @IsOptional()
  @IsString()
  supplierBankAccName?: string;
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

  @ApiProperty({ example: 'TRF-2026-001' })
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @ApiProperty({
    example: 'BANK_TRANSFER',
    enum: ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER'],
  })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({ example: '2026-05-29T10:00:00.000Z' })
  @IsDateString()
  paidAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendReceiptToSupplier?: boolean;
}
