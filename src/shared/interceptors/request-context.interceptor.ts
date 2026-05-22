import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { requestContextStorage } from '../context/request-context';
import { RequestContext } from '../../../packages/types/identity';

/**
 * Re-establishes the AsyncLocalStorage context for every request that has
 * a _billinxContext attached by JwtGuard or ApiKeyGuard.
 *
 * Guards set (request as any)._billinxContext synchronously.  This interceptor
 * then wraps the entire handler execution inside requestContextStorage.run()
 * so that any call to getRequestContext() inside controllers or inner
 * interceptors finds the correct store — regardless of async boundaries.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const billinxContext = request._billinxContext as
      | RequestContext
      | undefined;

    if (!billinxContext) return next.handle();

    // Run the entire downstream Observable chain (interceptors + handler)
    // inside the ALS context so that getRequestContext() always resolves.
    return new Observable((subscriber) => {
      const subscription = requestContextStorage.run(billinxContext, () =>
        next.handle().subscribe(subscriber),
      );
      return () => subscription?.unsubscribe();
    });
  }
}
