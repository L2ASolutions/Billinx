/// <reference types="jest" />

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { FlexAuthGuard } from './flex-auth.guard';

describe('FlexAuthGuard', () => {
  let jwtGuard: { canActivate: jest.Mock };
  let apiKeyGuard: { canActivate: jest.Mock };
  let guard: FlexAuthGuard;
  const context = {} as ExecutionContext;

  beforeEach(() => {
    jwtGuard = { canActivate: jest.fn() };
    apiKeyGuard = { canActivate: jest.fn() };
    guard = new FlexAuthGuard(jwtGuard as any, apiKeyGuard as any);
  });

  it('grants access via JWT without ever trying the API key guard', async () => {
    jwtGuard.canActivate.mockResolvedValue(true);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('falls back to the API key guard when the JWT guard throws', async () => {
    jwtGuard.canActivate.mockRejectedValue(new UnauthorizedException('no jwt'));
    apiKeyGuard.canActivate.mockResolvedValue(true);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledWith(context);
  });

  it('propagates the API key guard error when both auth methods fail', async () => {
    jwtGuard.canActivate.mockRejectedValue(new UnauthorizedException('no jwt'));
    apiKeyGuard.canActivate.mockRejectedValue(
      new UnauthorizedException('no api key either'),
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      'no api key either',
    );
  });
});
