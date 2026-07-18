import { IsNumber, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AdjustmentType {
  SALE = 'SALE',
  PURCHASE = 'PURCHASE',
  ADJUSTMENT = 'ADJUSTMENT',
  OPENING = 'OPENING',
  RETURN = 'RETURN',
  WRITE_OFF = 'WRITE_OFF',
}

export class AdjustStockDto {
  @ApiProperty({
    example: -5,
    description:
      'Signed quantity change. Positive adds stock, negative removes it (e.g. a write-off).',
  })
  @IsNumber()
  quantity!: number;

  @ApiProperty({ enum: AdjustmentType, example: AdjustmentType.ADJUSTMENT })
  @IsEnum(AdjustmentType)
  type!: AdjustmentType;

  @ApiPropertyOptional({ example: 'Damaged stock found during audit' })
  @IsOptional()
  @IsString()
  notes?: string;
}
