import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { runWithContext } from '../context/request-context';
import { RequestContext } from '../../../packages/types/identity';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const billinxContext = (request as any)._billinxContext as RequestContext | undefined;

    if (!billinxContext) return next.handle();

    return new Observable((subscriber) => {
      let sub: Subscription | undefined;
      runWithContext(billinxContext, () => {
        sub = next.handle().subscribe(subscriber);
      });
      return () => sub?.unsubscribe();
    });
  }
}
