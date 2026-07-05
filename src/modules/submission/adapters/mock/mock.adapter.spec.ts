/// <reference types="jest" />

import { MockAdapter } from './mock.adapter';
import { SubmissionRequest } from '../../../../../packages/types/submission';

function makeRequest(
  overrides: Partial<SubmissionRequest> = {},
): SubmissionRequest {
  return {
    invoiceId: 'invoice-1',
    tenantId: 'tenant-1',
    platformIrn: 'INV20260001-SVC00001-20260602',
    adapterKey: 'mock',
    payload: {},
    ...overrides,
  };
}

describe('MockAdapter', () => {
  let adapter: MockAdapter;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new MockAdapter();
    jest.useFakeTimers();
  });

  afterEach(() => {
    randomSpy?.mockRestore();
    jest.useRealTimers();
  });

  it('exposes its adapter key and name', () => {
    expect(adapter.adapterKey).toBe('mock');
    expect(adapter.adapterName).toContain('Mock');
  });

  describe('submit', () => {
    it('returns an accepted result with a well-formed FIRS IRN, csid, and QR code when the acceptance roll succeeds', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.05);

      const promise = adapter.submit(makeRequest());
      await jest.advanceTimersByTimeAsync(2100);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.firsConfirmedIrn).toMatch(
        /^NGA-MBS-2026-06-02-SVC-[0-9A-F]{8}$/,
      );
      expect(result.csid).toMatch(/^SHA256:[0-9a-f]{64}$/);
      expect(typeof result.qrCodeBase64).toBe('string');
      expect(result.qrCodeBase64!.length).toBeGreaterThan(0);
      expect(result.rawResponse).toMatchObject({
        status: 'ACCEPTED',
        firsIrn: result.firsConfirmedIrn,
        accessPoint: 'MockAdapter/Sandbox',
      });
    });

    it('returns a non-retryable rejection when the acceptance roll fails', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

      const promise = adapter.submit(makeRequest());
      await jest.advanceTimersByTimeAsync(2100);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FIRS-ERR-4021');
      expect(result.retryable).toBe(false);
    });

    it('falls back to default date/service-id segments when platformIrn is malformed', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.05);

      const promise = adapter.submit(makeRequest({ platformIrn: 'malformed' }));
      await jest.advanceTimersByTimeAsync(2100);
      const result = await promise;

      expect(result.firsConfirmedIrn).toMatch(
        /^NGA-MBS-2026-01-01-SVC-[0-9A-F]{8}$/,
      );
    });
  });

  describe('checkStatus', () => {
    it('always returns an accepted result derived from the given platformIrn', async () => {
      const promise = adapter.checkStatus('INV20260001-SVC00001-20260602', {});
      await jest.advanceTimersByTimeAsync(300);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.firsConfirmedIrn).toMatch(
        /^NGA-MBS-2026-06-02-SVC-[0-9A-F]{8}$/,
      );
      expect(result.rawResponse).toEqual({ status: 'ACCEPTED' });
    });
  });

  describe('ping', () => {
    it('always resolves true', async () => {
      const promise = adapter.ping();
      await jest.advanceTimersByTimeAsync(100);
      await expect(promise).resolves.toBe(true);
    });
  });
});
