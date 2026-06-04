import { IsNumber, IsEnum, IsOptional, IsString } from 'class-validator';

export enum AdjustmentType {
  SALE = 'SALE',
  PURCHASE = 'PURCHASE',
  ADJUSTMENT = 'ADJUSTMENT',
  OPENING = 'OPENING',
  RETURN = 'RETURN',
  WRITE_OFF = 'WRITE_OFF',
}

export class AdjustStockDto {
  @IsNumber()
  quantity!: number;

  @IsEnum(AdjustmentType)
  type!: AdjustmentType;

  @IsOptional()
  @IsString()
  notes?: string;
}
