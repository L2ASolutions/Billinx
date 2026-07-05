/// <reference types="jest" />

import { KybController } from './kyb.controller';
import { KybService } from './services/kyb.service';

describe('KybController', () => {
  let controller: KybController;
  let kybService: jest.Mocked<Pick<KybService, 'confirmTin' | 'verifyCac'>>;

  beforeEach(() => {
    kybService = {
      confirmTin: jest
        .fn()
        .mockResolvedValue({ message: 'ok', kybId: 'kyb-1' }),
      verifyCac: jest.fn().mockResolvedValue({ riskScore: 'GREEN' }),
    };
    controller = new KybController(kybService as any);
  });

  describe('confirmTin', () => {
    it('coerces confirmed to a boolean and forwards the requester IP', async () => {
      const req = { ip: '10.0.0.1' } as any;

      await controller.confirmTin(
        { accessRequestId: 'req-1', confirmed: 'true', proofNote: 'note' },
        req,
      );

      expect(kybService.confirmTin).toHaveBeenCalledWith({
        accessRequestId: 'req-1',
        confirmed: true,
        proofNote: 'note',
        ipAddress: '10.0.0.1',
      });
    });

    it('coerces a missing/falsy confirmed value to false', async () => {
      const req = { ip: '10.0.0.1' } as any;

      await controller.confirmTin({ accessRequestId: 'req-1' }, req);

      expect(kybService.confirmTin).toHaveBeenCalledWith(
        expect.objectContaining({ confirmed: false }),
      );
    });
  });

  it('verifyCac delegates accessRequestId and rcNumber to the service', async () => {
    await controller.verifyCac({ accessRequestId: 'req-1', rcNumber: 'RC1' });

    expect(kybService.verifyCac).toHaveBeenCalledWith({
      accessRequestId: 'req-1',
      rcNumber: 'RC1',
    });
  });
});
