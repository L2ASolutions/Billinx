/// <reference types="jest" />

import { ProductCatalogController } from './product-catalog.controller';
import { ProductCatalogService } from './product-catalog.service';

const TENANT_ID = 'tenant-001';

function makeRequest(): any {
  return { _billinxContext: { tenantId: TENANT_ID } };
}

describe('ProductCatalogController', () => {
  let controller: ProductCatalogController;
  let service: jest.Mocked<
    Pick<
      ProductCatalogService,
      | 'createProduct'
      | 'listProducts'
      | 'getProductAsLineItem'
      | 'getProduct'
      | 'updateProduct'
      | 'deleteProduct'
    >
  >;

  beforeEach(() => {
    service = {
      createProduct: jest.fn().mockResolvedValue({ id: 'product-1' }),
      listProducts: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getProductAsLineItem: jest.fn().mockResolvedValue({ description: 'x' }),
      getProduct: jest.fn().mockResolvedValue({ id: 'product-1' }),
      updateProduct: jest.fn().mockResolvedValue({ id: 'product-1' }),
      deleteProduct: jest
        .fn()
        .mockResolvedValue({ deleted: true, id: 'product-1' }),
    };
    controller = new ProductCatalogController(service as any);
  });

  it('createProduct scopes the request body to the caller tenant', async () => {
    const body = { name: 'Widget', unitPrice: 100 };
    await controller.createProduct(body, makeRequest());
    expect(service.createProduct).toHaveBeenCalledWith(TENANT_ID, body);
  });

  it('listProducts forwards search/category/isActive filters scoped to the tenant', async () => {
    await controller.listProducts(makeRequest(), 'widget', 'hardware', 'true');
    expect(service.listProducts).toHaveBeenCalledWith(TENANT_ID, {
      search: 'widget',
      category: 'hardware',
      isActive: 'true',
    });
  });

  it('getProductAsLineItem scopes the lookup to the caller tenant', async () => {
    await controller.getProductAsLineItem('product-1', makeRequest());
    expect(service.getProductAsLineItem).toHaveBeenCalledWith(
      'product-1',
      TENANT_ID,
    );
  });

  it('getProduct scopes the lookup to the caller tenant', async () => {
    await controller.getProduct('product-1', makeRequest());
    expect(service.getProduct).toHaveBeenCalledWith('product-1', TENANT_ID);
  });

  it('updateProduct scopes the update to the caller tenant', async () => {
    const body = { name: 'New Name' };
    await controller.updateProduct('product-1', body, makeRequest());
    expect(service.updateProduct).toHaveBeenCalledWith(
      'product-1',
      TENANT_ID,
      body,
    );
  });

  it('deleteProduct scopes the delete to the caller tenant', async () => {
    await controller.deleteProduct('product-1', makeRequest());
    expect(service.deleteProduct).toHaveBeenCalledWith('product-1', TENANT_ID);
  });
});
