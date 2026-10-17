locals {
  name_prefix = "compass-${var.env}"

  # Per-IP request ceiling over the five minute evaluation window. WAF counts
  # source addresses in memory only; nothing is logged (Requirement 4.10).
  rate_limit = 600

  site_origin_id = "site"
  api_origin_id  = "api"

  # Viewer-request function for the site behaviour only. It rewrites a
  # directory-style path to its index document so clean URLs resolve against the
  # private S3 origin, and leaves a request for a file untouched. It is never
  # attached to /api/*, so API request URIs reach the origin as sent.
  site_viewer_request_code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
      } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        request.uri = uri + '/index.html';
      }
      return request;
    }
  EOT

  # Strict policy for a static, prerendered site that calls only its own origin.
  # Inline styles are allowed because the Angular build inlines critical CSS.
  content_security_policy = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])

  permissions_policy = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
}
