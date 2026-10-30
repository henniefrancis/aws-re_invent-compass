locals {
  name_prefix = "compass-${var.env}"

  # Per-IP request ceiling over the five minute evaluation window. WAF counts
  # source addresses in memory only; nothing is logged (Requirement 4.10).
  rate_limit = 600

  # Tighter ceiling for the PassKit web service paths, over the same window.
  passkit_rate_limit = 300

  # High per-IP ceiling for the site (every path outside /api/), over the same
  # window. It stops a flood against the static site without touching a busy
  # attendee page load.
  site_rate_limit = 3000

  # Largest request body the API accepts. The contract allows at most 25 passes
  # of under 1 KB each (about 15 KB) or 80 hand-off ids (about 4 KB), so 64 KB
  # leaves a wide margin. WAF inspects up to the same limit and a larger body is
  # blocked on /api/*.
  api_body_limit_bytes = 65536

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

  # The Required_CSP from the site (site/scripts/required-csp.mjs is the single source; a
  # static test keeps the two identical). The build inlines nothing (inlineCritical is off), so
  # styles need no unsafe-inline. base-uri is self because the pages carry <base href="/">.
  content_security_policy = join("; ", [
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
    "upgrade-insecure-requests",
  ])

  permissions_policy = "accelerometer=(), camera=(), geolocation=(self), gyroscope=(), microphone=(), payment=(), usb=()"

  # Custom domain: the aliases, and the A and AAAA alias records for each of them.
  custom_domain = var.domain_name != null
  aliases       = local.custom_domain ? concat([var.domain_name], var.extra_aliases) : []

  alias_records = {
    for pair in setproduct(local.aliases, ["A", "AAAA"]) :
    "${pair[0]}/${pair[1]}" => { name = pair[0], type = pair[1] }
  }
}
