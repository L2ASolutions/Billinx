import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'TypeError: Cannot read properties of undefined' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  errorMessage!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  stackTrace?: string;

  @ApiProperty({ example: 'https://app.billinx.ng/invoices/abc-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  pageUrl!: string;

  @ApiProperty({ example: 'Chrome 128 on macOS 14.5' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  browserInfo!: string;

  @ApiPropertyOptional({
    description: 'Optional free-text context the user added',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userDescription?: string;
}
