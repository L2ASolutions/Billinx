import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { KybService } from './services/kyb.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AuthRateLimitGuard } from '../../shared/guards/auth-rate-limit.guard';

@ApiTags('KYB')
@Controller('v1')
export class KybController {
  constructor(private readonly kybService: KybService) {}

  @Post('kyb/tin-confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Confirm TIN for an access request (access requester self-serve)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Confirm TIN for an access request (access requester self-serve)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async confirmTin(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.kybService.confirmTin({
      accessRequestId: body.accessRequestId,
      confirmed: !!body.confirmed,
      proofNote: body.proofNote,
      ipAddress: req.ip,
    });
  }

  @Post('admin/kyb/verify-cac')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Admin: verify CAC registration for an access request',
  })
  @ApiResponse({
    status: 200,
    description: 'Admin: verify CAC registration for an access request',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async verifyCac(@Body() body: Record<string, any>) {
    return this.kybService.verifyCac({
      accessRequestId: body.accessRequestId,
      rcNumber: body.rcNumber,
    });
  }
}
