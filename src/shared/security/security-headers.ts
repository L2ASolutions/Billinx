import helmet from 'helmet';

// All six recommended Helmet directives below are explicitly enabled — none
// are disabled. Helmet's combined helmet({...}) call accepts these exact
// option keys as first-class aliases for the named helmet.xxx() middlewares
// (see node_modules/helmet's getMiddlewareFunctionsFromOptions).
export function buildHelmetOptions(isProduction: boolean) {
  return {
    // helmet.contentSecurityPolicy() — previously `false` ("managed at
    // ALB/CDN level"), which is not a documented, verifiable control and left
    // the app with no CSP at all. Locked to 'self'/'none' for this JSON API;
    // relaxed script/style-src only in development, where /docs (Swagger UI,
    // mounted only when NODE_ENV !== 'production') needs inline scripts/styles
    // to render — never reachable in production.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        styleSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      },
    },
    // helmet.hsts()
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    // helmet.noSniff()
    noSniff: true,
    // helmet.frameguard() — this is a JSON API; it should never be framed
    frameguard: { action: 'deny' as const },
    // helmet.xssFilter() — explicitly sets X-XSS-Protection: 0. This mirrors
    // helmet's own default and current OWASP guidance: the legacy browser XSS
    // auditor this header controls is deprecated/removed in modern browsers
    // and has itself been a source of vulnerabilities; CSP above is the
    // modern replacement for the protection it used to provide.
    xssFilter: true,
    // helmet.hidePoweredBy()
    hidePoweredBy: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' as const },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' as const },
  };
}

export function applySecurityHeaders(
  app: { use: (middleware: unknown) => unknown },
  isProduction: boolean,
): void {
  app.use(helmet(buildHelmetOptions(isProduction)));
}
