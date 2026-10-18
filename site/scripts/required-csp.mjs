// The Required_CSP (showcase-site, Component 19): the Content-Security-Policy the site is built
// to run under. This is the single source. site/README.md quotes it for S6 (the CloudFront
// response headers policy) and a test compares the two.
//
// base-uri is 'self', not 'none': the built pages carry <base href="/"> so that the router and
// the relative asset links work at /demo and at /demo/ alike, and base-uri 'none' would block
// that element. Everything else is as the requirements list it.

export const CSP_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  'upgrade-insecure-requests',
]);

export const REQUIRED_CSP = CSP_DIRECTIVES.join('; ');

// The Static_Server answers over plain http on 127.0.0.1. WebKit (and so every iPad and iPhone
// profile) honours upgrade-insecure-requests there and rewrites the page's own script and style
// requests to https, which a plain http server cannot answer. For local runs only, the
// Static_Server therefore sends the Required_CSP without that one directive. CloudFront sends the
// full Required_CSP.
export const LOCAL_CSP = CSP_DIRECTIVES.filter(
  (directive) => directive !== 'upgrade-insecure-requests',
).join('; ');
