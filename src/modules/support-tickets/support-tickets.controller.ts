import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { SupportTicketService } from './support-ticket.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { OptionalJwtGuard } from '../identity/guards/optional-jwt.guard';
import { SupportTicketRateLimitGuard } from '../../shared/guards/support-ticket-rate-limit.guard';

const MAX_SCREENSHOT_SIZE = 8 * 1024 * 1024; // 8 MB — a full-viewport PNG

@ApiTags('Support Tickets')
@Controller('v1/support-tickets')
export class SupportTicketsController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Order matters: OptionalJwtGuard populates the request context (when a
  // token is present) before the rate limiter reads it to pick a bucket.
  @UseGuards(OptionalJwtGuard, SupportTicketRateLimitGuard)
  @UseInterceptors(
    FileInterceptor('screenshot', {
      limits: { fileSize: MAX_SCREENSHOT_SIZE },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        screenshot: { type: 'string', format: 'binary' },
        errorMessage: { type: 'string' },
        stackTrace: { type: 'string' },
        pageUrl: { type: 'string' },
        browserInfo: { type: 'string' },
        userDescription: { type: 'string' },
      },
      required: ['screenshot', 'errorMessage', 'pageUrl', 'browserInfo'],
    },
  })
  @ApiOperation({
    summary:
      'Report an error (auto-capture on crash, or manual "Report an issue"). Works with or without an Authorization header.',
  })
  @ApiResponse({ status: 201, description: 'Support ticket created' })
  @ApiResponse({ status: 400, description: 'Invalid request body or file' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async create(
    @Body() dto: CreateSupportTicketDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_SCREENSHOT_SIZE }),
        ],
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        fileIsRequired: true,
      }),
    )
    screenshot: Express.Multer.File,
  ) {
    return this.supportTicketService.createTicket(dto, screenshot);
  }
}
