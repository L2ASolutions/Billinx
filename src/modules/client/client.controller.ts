import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ClientService } from './client.service';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('Clients')
@Controller('v1/clients')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Get('frequent')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get top 5 clients by invoice count' })
  async getFrequent(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.clientService.getFrequent(ctx.tenantId);
  }

  @Get()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List clients' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = this.getCtx(req);
    return this.clientService.findAll(
      ctx.tenantId,
      search,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a client by ID' })
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.clientService.findOne(ctx.tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a client' })
  async create(@Body() body: Record<string, any>, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.clientService.create(ctx.tenantId, body);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a client' })
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.clientService.update(ctx.tenantId, id, body);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a client' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.clientService.delete(ctx.tenantId, id);
  }
}
