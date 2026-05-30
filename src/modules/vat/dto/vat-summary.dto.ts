import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class VatSummaryQueryDto {
  @ApiPropertyOptional({ description: 'YYYY-MM period' })
  @IsOptional()
  @IsString()
  period?: string;
}

export class VatAnnualQueryDto {
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;
}

export class VatMismatchQueryDto {
  @ApiPropertyOptional({ description: 'YYYY-MM period' })
  @IsOptional()
  @IsString()
  period?: string;
}
