import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class VatEntryFilterDto {
  @ApiPropertyOptional({ enum: ['OUTPUT', 'INPUT'] })
  @IsOptional()
  @IsIn(['OUTPUT', 'INPUT'])
  type?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM period' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({
    enum: ['UNRECONCILED', 'RECONCILED', 'DISPUTED', 'EXEMPT'],
  })
  @IsOptional()
  @IsIn(['UNRECONCILED', 'RECONCILED', 'DISPUTED', 'EXEMPT'])
  status?: string;

  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
