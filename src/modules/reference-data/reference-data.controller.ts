import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ReferenceDataService } from './reference-data.service';
import { ReferenceSearchRateLimitGuard } from '../../shared/guards/reference-search-rate-limit.guard';

@ApiTags('Reference Data')
@Controller('v1/reference')
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Get('invoice-types')
  @ApiOperation({ summary: 'Get all FIRS invoice types' })
  @ApiResponse({ status: 200, description: 'Get all FIRS invoice types' })
  getInvoiceTypes() {
    return this.referenceDataService.getInvoiceTypes();
  }

  @Get('payment-means')
  @ApiOperation({ summary: 'Get all payment means codes' })
  @ApiResponse({ status: 200, description: 'Get all payment means codes' })
  getPaymentMeans() {
    return this.referenceDataService.getPaymentMeans();
  }

  @Get('tax-categories')
  @ApiOperation({ summary: 'Get all tax categories' })
  @ApiResponse({ status: 200, description: 'Get all tax categories' })
  getTaxCategories() {
    return this.referenceDataService.getTaxCategories();
  }

  @Get('currencies')
  @ApiOperation({ summary: 'Get all currencies' })
  @ApiResponse({ status: 200, description: 'Get all currencies' })
  getCurrencies() {
    return this.referenceDataService.getCurrencies();
  }

  @Get('hs-codes')
  @UseGuards(ReferenceSearchRateLimitGuard)
  @ApiOperation({ summary: 'Search HS codes by code or description' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Search HS codes by code or description',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getHsCodes(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.referenceDataService.getHsCodes(
      search,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('service-codes')
  @UseGuards(ReferenceSearchRateLimitGuard)
  @ApiOperation({ summary: 'Search service codes by code or description' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Search service codes by code or description',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getServiceCodes(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.referenceDataService.getServiceCodes(
      search,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('states')
  @ApiOperation({ summary: 'Get all Nigerian states' })
  @ApiResponse({ status: 200, description: 'Get all Nigerian states' })
  getStates() {
    return this.referenceDataService.getStates();
  }

  @Get('lgas')
  @ApiOperation({ summary: 'Get LGAs for a Nigerian state' })
  @ApiQuery({ name: 'stateCode', required: true, description: 'e.g. NG-LA' })
  @ApiResponse({ status: 200, description: 'Get LGAs for a Nigerian state' })
  getLgas(@Query('stateCode') stateCode: string) {
    return this.referenceDataService.getLgas(stateCode);
  }

  @Get('countries')
  @ApiOperation({ summary: 'Search countries by name or ISO code' })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({
    status: 200,
    description: 'Search countries by name or ISO code',
  })
  getCountries(@Query('search') search?: string) {
    return this.referenceDataService.getCountries(search);
  }

  @Get('quantity-codes')
  @ApiOperation({ summary: 'Get all unit of measure / quantity codes' })
  @ApiResponse({
    status: 200,
    description: 'Get all unit of measure / quantity codes',
  })
  getQuantityCodes() {
    return this.referenceDataService.getQuantityCodes();
  }
}
