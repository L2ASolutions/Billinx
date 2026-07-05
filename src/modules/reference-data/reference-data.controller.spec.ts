/// <reference types="jest" />

import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';

describe('ReferenceDataController', () => {
  let controller: ReferenceDataController;
  let service: jest.Mocked<
    Pick<
      ReferenceDataService,
      | 'getInvoiceTypes'
      | 'getPaymentMeans'
      | 'getTaxCategories'
      | 'getCurrencies'
      | 'getHsCodes'
      | 'getServiceCodes'
      | 'getStates'
      | 'getLgas'
      | 'getCountries'
      | 'getQuantityCodes'
    >
  >;

  beforeEach(() => {
    service = {
      getInvoiceTypes: jest.fn().mockResolvedValue([]),
      getPaymentMeans: jest.fn().mockResolvedValue([]),
      getTaxCategories: jest.fn().mockResolvedValue([]),
      getCurrencies: jest.fn().mockResolvedValue([]),
      getHsCodes: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getServiceCodes: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getStates: jest.fn().mockResolvedValue([]),
      getLgas: jest.fn().mockResolvedValue([]),
      getCountries: jest.fn().mockResolvedValue([]),
      getQuantityCodes: jest.fn().mockResolvedValue([]),
    };
    controller = new ReferenceDataController(service as any);
  });

  it('getInvoiceTypes delegates to the service', async () => {
    await controller.getInvoiceTypes();
    expect(service.getInvoiceTypes).toHaveBeenCalled();
  });

  it('getPaymentMeans delegates to the service', async () => {
    await controller.getPaymentMeans();
    expect(service.getPaymentMeans).toHaveBeenCalled();
  });

  it('getTaxCategories delegates to the service', async () => {
    await controller.getTaxCategories();
    expect(service.getTaxCategories).toHaveBeenCalled();
  });

  it('getCurrencies delegates to the service', async () => {
    await controller.getCurrencies();
    expect(service.getCurrencies).toHaveBeenCalled();
  });

  describe('getHsCodes', () => {
    it('parses limit/offset query strings to numbers', async () => {
      await controller.getHsCodes('widget', '50', '10');
      expect(service.getHsCodes).toHaveBeenCalledWith('widget', 50, 10);
    });

    it('defaults limit to 20 and offset to 0 when omitted', async () => {
      await controller.getHsCodes(undefined, undefined, undefined);
      expect(service.getHsCodes).toHaveBeenCalledWith(undefined, 20, 0);
    });
  });

  describe('getServiceCodes', () => {
    it('parses limit/offset query strings to numbers', async () => {
      await controller.getServiceCodes('consult', '50', '10');
      expect(service.getServiceCodes).toHaveBeenCalledWith('consult', 50, 10);
    });

    it('defaults limit to 20 and offset to 0 when omitted', async () => {
      await controller.getServiceCodes(undefined, undefined, undefined);
      expect(service.getServiceCodes).toHaveBeenCalledWith(undefined, 20, 0);
    });
  });

  it('getStates delegates to the service', async () => {
    await controller.getStates();
    expect(service.getStates).toHaveBeenCalled();
  });

  it('getLgas delegates the stateCode query param', async () => {
    await controller.getLgas('NG-LA');
    expect(service.getLgas).toHaveBeenCalledWith('NG-LA');
  });

  it('getCountries delegates the optional search query param', async () => {
    await controller.getCountries('nigeria');
    expect(service.getCountries).toHaveBeenCalledWith('nigeria');
  });

  it('getQuantityCodes delegates to the service', async () => {
    await controller.getQuantityCodes();
    expect(service.getQuantityCodes).toHaveBeenCalled();
  });
});
