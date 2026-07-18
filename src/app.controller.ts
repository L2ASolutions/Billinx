import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Root greeting',
    description:
      'Simple unauthenticated liveness banner; use GET /health for a real health check.',
  })
  @ApiResponse({ status: 200, description: 'Greeting string' })
  getHello(): string {
    return this.appService.getHello();
  }
}
