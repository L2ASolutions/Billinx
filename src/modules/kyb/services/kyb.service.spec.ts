/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { KybService } from './kyb.service';

function makePrisma(tx: Record<string, any>) {
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('KybService', () => {
  let tx: Record<string, any>;
  let prisma: ReturnType<typeof makePrisma>;
  let service: KybService;
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    tx = {
      accessRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'req-1',
          tin: 'TIN123',
          companyName: 'Acme Nigeria Limited',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      kybVerification: {
        upsert: jest.fn().mockResolvedValue({ id: 'kyb-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = makePrisma(tx);
    service = new KybService(prisma as any);
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  describe('confirmTin', () => {
    it('throws NotFoundException when the access request does not exist', async () => {
      tx.accessRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.confirmTin({ accessRequestId: 'missing', confirmed: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('records confirmation with timestamp and IP when confirmed=true', async () => {
      const result = await service.confirmTin({
        accessRequestId: 'req-1',
        confirmed: true,
        proofNote: 'saw the cert',
        ipAddress: '10.0.0.1',
      });

      expect(tx.kybVerification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accessRequestId: 'req-1' },
          create: expect.objectContaining({
            tin: 'TIN123',
            tinUserConfirmed: true,
            tinConfirmedAt: expect.any(Date),
            tinConfirmedIp: '10.0.0.1',
            tinProofNote: 'saw the cert',
          }),
        }),
      );
      expect(result.kybId).toBe('kyb-1');
    });

    it('nulls out confirmedAt/confirmedIp when confirmed=false', async () => {
      await service.confirmTin({ accessRequestId: 'req-1', confirmed: false });

      expect(tx.kybVerification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            tinUserConfirmed: false,
            tinConfirmedAt: null,
            tinConfirmedIp: null,
          }),
        }),
      );
    });
  });

  describe('verifyCac', () => {
    it('throws NotFoundException when the access request does not exist', async () => {
      tx.accessRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyCac({ accessRequestId: 'missing', rcNumber: 'RC1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('marks RED with an error message when CAC_API_BASE_URL is not configured', async () => {
      delete process.env.CAC_API_BASE_URL;

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(result.riskScore).toBe('RED');
      expect(result.error).toContain('CAC_API_BASE_URL is not configured');
      expect(tx.kybVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cacVerified: false,
            riskScore: 'RED',
          }),
        }),
      );
      expect(tx.accessRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { kybScore: 'RED' } }),
      );
    });

    it('marks RED with an error message when the CAC API responds non-OK', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(result.riskScore).toBe('RED');
      expect(result.error).toContain('503');
    });

    it('marks RED when the CAC API request throws (network error/timeout)', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(result.riskScore).toBe('RED');
      expect(result.error).toBe('timeout');
    });

    it('scores a near-exact company name match as GREEN/HIGH_CONFIDENCE', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          companyName: 'Acme Nigeria Ltd',
          status: 'ACTIVE',
          registrationDate: '2020-01-01',
          directors: ['Jane Doe'],
        }),
      });

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(result.riskScore).toBe('GREEN');
      expect(result.nameMatchResult).toBe('HIGH_CONFIDENCE');
      expect(result.riskReasons).toEqual([]);
      expect(tx.kybVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cacVerified: true,
            cacCompanyName: 'Acme Nigeria Ltd',
            riskScore: 'GREEN',
          }),
        }),
      );
      expect(tx.accessRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { kybScore: 'GREEN' } }),
      );
    });

    it('scores a completely different company name as RED/LOW_CONFIDENCE with a reason', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          companyName: 'Zenith Trading Co',
          status: 'ACTIVE',
        }),
      });

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(result.riskScore).toBe('RED');
      expect(result.nameMatchResult).toBe('LOW_CONFIDENCE');
      expect(result.riskReasons[0]).toContain('Name match');
    });

    it('flags a non-ACTIVE CAC company status as an additional risk reason', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          companyName: 'Acme Nigeria Limited',
          status: 'INACTIVE',
        }),
      });

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(
        result.riskReasons.some((r: string) =>
          r.includes('CAC company status: INACTIVE'),
        ),
      ).toBe(true);
    });

    it('reads alternate CAC field name variants (company_name, company_status, rcDate, proprietors)', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          company_name: 'Acme Nigeria Limited',
          company_status: 'REGISTERED',
          rcDate: '2019-05-01',
          proprietors: ['John Doe'],
        }),
      });

      const result = await service.verifyCac({
        accessRequestId: 'req-1',
        rcNumber: 'RC1',
      });

      expect(result.cacCompanyName).toBe('Acme Nigeria Limited');
      expect(result.cacStatus).toBe('REGISTERED');
      expect(result.cacRegistrationDate).toBe('2019-05-01');
    });

    it('includes an Authorization header only when CAC_API_KEY is set', async () => {
      process.env.CAC_API_BASE_URL = 'https://cac.example.com';
      process.env.CAC_API_KEY = 'secret-key';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          companyName: 'Acme Nigeria Limited',
          status: 'ACTIVE',
        }),
      });
      global.fetch = fetchMock;

      await service.verifyCac({ accessRequestId: 'req-1', rcNumber: 'RC1' });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer secret-key');
    });

    it('upserts a KybVerification row before making the network call', async () => {
      delete process.env.CAC_API_BASE_URL;

      await service.verifyCac({ accessRequestId: 'req-1', rcNumber: 'RC-999' });

      expect(tx.kybVerification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accessRequestId: 'req-1' },
          create: expect.objectContaining({ cacRcNumber: 'RC-999' }),
        }),
      );
      expect(tx.accessRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { cacRcNumber: 'RC-999' },
      });
    });
  });
});
