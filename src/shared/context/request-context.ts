import { AsyncLocalStorage } from 'async_hooks';
import { RequestContext } from '../../../packages/types/identity';

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  const ctx = requestContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      'Request context not initialised. Ensure TenantContextGuard runs before this call.',
    );
  }
  return ctx;
}

export function getOptionalRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}
