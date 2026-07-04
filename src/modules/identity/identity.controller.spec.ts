/// <reference types="jest" />

import { HttpStatus } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { ApiKeyService } from './services/api-key.service';
import { TokenService } from './services/token.service';

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

function makeResponse() {
  const res: any = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('IdentityController', () => {
  let controller: IdentityController;
  let apiKeyService: jest.Mocked<
    Pick<
      ApiKeyService,
      'createApiKey' | 'listApiKeys' | 'rotateApiKey' | 'revokeApiKey'
    >
  >;
  let tokenService: jest.Mocked<
    Pick<TokenService, 'rotateRefreshToken' | 'revokeAllUserTokens'>
  >;

  beforeEach(() => {
    apiKeyService = {
      createApiKey: jest.fn().mockResolvedValue({ id: 'key-1' }),
      listApiKeys: jest.fn().mockResolvedValue([{ id: 'key-1' }]),
      rotateApiKey: jest.fn().mockResolvedValue({ id: 'key-2' }),
      revokeApiKey: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = {
      rotateRefreshToken: jest.fn().mockResolvedValue({
        tokenResponse: {
          accessToken: 'new-access',
          expiresIn: 900,
          tokenType: 'Bearer',
        },
        newRefreshToken: 'new-refresh',
      }),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
    };
    controller = new IdentityController(
      apiKeyService as any,
      tokenService as any,
    );
  });

  describe('refreshToken', () => {
    it('returns 401 without calling the service when no refresh token cookie is present', async () => {
      const req: any = { cookies: {} };
      const res = makeResponse();

      await controller.refreshToken(req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(tokenService.rotateRefreshToken).not.toHaveBeenCalled();
    });

    it('rotates the token, sets the new cookie, and returns the token response', async () => {
      const req: any = { cookies: { billinx_refresh_token: 'old-refresh' } };
      const res = makeResponse();

      const result = await controller.refreshToken(req, res);

      expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith(
        'old-refresh',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'billinx_refresh_token',
        'new-refresh',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({
        accessToken: 'new-access',
        expiresIn: 900,
        tokenType: 'Bearer',
      });
    });
  });

  describe('revokeToken', () => {
    it('clears the cookie without revoking all tokens when body.all is falsy', async () => {
      const res = makeResponse();
      await controller.revokeToken({ all: false }, res);
      expect(tokenService.revokeAllUserTokens).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('billinx_refresh_token');
    });

    it('revokes all user tokens when body.all is true', async () => {
      const res = makeResponse();
      await controller.revokeToken({ all: true }, res);
      expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        'user-001',
        'tenant-001',
      );
      expect(res.clearCookie).toHaveBeenCalledWith('billinx_refresh_token');
    });
  });

  describe('API key management (API-key-auth routes)', () => {
    it('createApiKey delegates the tenantId from context and the body', async () => {
      const body = { name: 'k', environment: 'PRODUCTION' } as any;
      await controller.createApiKey(body);
      expect(apiKeyService.createApiKey).toHaveBeenCalledWith(
        'tenant-001',
        body,
      );
    });

    it('listApiKeys delegates the tenantId from context', async () => {
      await controller.listApiKeys();
      expect(apiKeyService.listApiKeys).toHaveBeenCalledWith('tenant-001');
    });

    it('rotateApiKey delegates the tenantId and keyId', async () => {
      await controller.rotateApiKey('key-1');
      expect(apiKeyService.rotateApiKey).toHaveBeenCalledWith(
        'tenant-001',
        'key-1',
      );
    });

    it('revokeApiKey delegates the tenantId and keyId', async () => {
      await controller.revokeApiKey('key-1');
      expect(apiKeyService.revokeApiKey).toHaveBeenCalledWith(
        'tenant-001',
        'key-1',
      );
    });
  });

  describe('API key management (dashboard/JWT-auth routes)', () => {
    it('createApiKeyDashboard delegates the same way as the API-key route', async () => {
      const body = { name: 'k', environment: 'PRODUCTION' } as any;
      await controller.createApiKeyDashboard(body);
      expect(apiKeyService.createApiKey).toHaveBeenCalledWith(
        'tenant-001',
        body,
      );
    });

    it('listApiKeysDashboard delegates the tenantId from context', async () => {
      await controller.listApiKeysDashboard();
      expect(apiKeyService.listApiKeys).toHaveBeenCalledWith('tenant-001');
    });

    it('rotateApiKeyDashboard delegates the tenantId and keyId', async () => {
      await controller.rotateApiKeyDashboard('key-1');
      expect(apiKeyService.rotateApiKey).toHaveBeenCalledWith(
        'tenant-001',
        'key-1',
      );
    });

    it('revokeApiKeyDashboard delegates the tenantId and keyId', async () => {
      await controller.revokeApiKeyDashboard('key-1');
      expect(apiKeyService.revokeApiKey).toHaveBeenCalledWith(
        'tenant-001',
        'key-1',
      );
    });
  });
});
