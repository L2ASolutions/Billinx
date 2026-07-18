/// <reference types="jest" />

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeGuard } from './scope.guard';

function makeContext(billinxContext: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ _billinxContext: billinxContext }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('ScopeGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: ScopeGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new ScopeGuard(reflector as unknown as Reflector);
  });

  it('allows the request when the route has no @RequireScope', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = makeContext({ actorType: 'apikey', scopes: [] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a JWT/dashboard user through regardless of required scope', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:write']);
    const context = makeContext({ actorType: 'user', scopes: undefined });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an admin/system actor through regardless of required scope', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:write']);
    const context = makeContext({ actorType: 'admin' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows through when there is no request context at all (public endpoint)', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:write']);
    const context = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a full-access ("*") API key through any required scope', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:write']);
    const context = makeContext({ actorType: 'apikey', scopes: ['*'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an API key that carries the exact required scope', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:read']);
    const context = makeContext({
      actorType: 'apikey',
      scopes: ['invoices:read', 'products:read'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an API key when it carries any one of several accepted scopes', () => {
    reflector.getAllAndOverride.mockReturnValue([
      'invoices:read',
      'reports:read',
    ]);
    const context = makeContext({
      actorType: 'apikey',
      scopes: ['reports:read'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an API key missing the required scope', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:write']);
    const context = makeContext({
      actorType: 'apikey',
      scopes: ['invoices:read'],
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an API key with no scopes at all', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:read']);
    const context = makeContext({ actorType: 'apikey', scopes: [] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an API key with an undefined scopes array', () => {
    reflector.getAllAndOverride.mockReturnValue(['invoices:read']);
    const context = makeContext({ actorType: 'apikey', scopes: undefined });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
