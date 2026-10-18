# ADR-031 Custom domain reinvent-compass.vegas

Status: Accepted, 2026-10-18 (owner decision; the pass host was dropped the same day). Amends ADR-002 and ADR-013 (the address of the public edge) and resolves ADR-027 item 6.

## Context

The public edge was planned on the CloudFront default address, `https://<distribution>.cloudfront.net`. That address is baked into every issued pass (`webServiceURL`) and into the npm package, and its default certificate lets viewers use TLS 1.0 (ADR-027 item 6). The owner registered `reinvent-compass.vegas`; its DNS is a Route 53 hosted zone in the same AWS account, created with the registration.

## Decision

- **One custom domain for the whole site.**
  - prod: the site, `/board` and the API on `reinvent-compass.vegas`, the apex alone.
  - dev: `dev.reinvent-compass.vegas` only.
- **Variables in each environment root:** `domain_name`, `extra_aliases` (both nullable: null keeps the CloudFront default domain and the old behaviour exactly) and `hosted_zone_name` (`reinvent-compass.vegas`).
- **The edge module** requests an ACM certificate in us-east-1 for the aliases, validates it with DNS records created in the existing zone, waits for the validation, sets the distribution `aliases` and `viewer_certificate` (the ACM certificate, SNI only, `TLSv1.2_2021`), and adds Route 53 A and AAAA alias records for each name.
- **The registration is managed in the bootstrap (amended 2026-10-18).** With `register_domain = true`, `aws_route53domains_domain` registers the domain for one year at a time, with auto-renew, the transfer lock, WHOIS privacy on every contact and `prevent_destroy`. Route 53 creates the hosted zone with the registration, so the zone is never a separate resource: the bootstrap takes its id from the registration, and the environment roots read it by name through a data source. With `register_domain = false` the bootstrap reads an existing zone instead. The contact is personal data and stays in the git-ignored tfvars and the bootstrap state.
- **PUBLIC_BASE_URL is derived** from the custom domain (`https://<domain_name>`), which removes the two-apply step (the distribution depended on the Lambdas, and the Lambdas needed the distribution address). An explicit `public_base_url` still wins, and with no domain the old path stays.
- **Least privilege.** The apply role may request, tag and delete ACM certificates only with the project and environment tags, and may change Route 53 records in that one zone only, for its own environment's names and for the A, AAAA and CNAME types (dev owns `dev.<zone>`, prod owns the apex, each with its certificate validation records). The plan role reads the zone, its records and the certificates. `release.sh` allows the new resource types.

## Consequences

- ADR-027 item 6 is resolved: viewers get TLS 1.2 or later on the custom domain.
- Cost: ACM public certificates are free; a Route 53 hosted zone costs about USD 0.50 a month plus query charges (a few cents at this scale). The domain registration is paid yearly and shows on the account bill in the month it is registered or renewed.
- The domain is registered with Route 53 Domains in the same account, so its name servers are normally set to the hosted zone automatically. The runbook keeps a check step: if the delegation were ever different, the certificate would never validate and the first apply would wait on it.
- **Passes use the apex.** The pass `webServiceURL` is `PUBLIC_BASE_URL` plus `PASSKIT_WEB_SERVICE_PATH`, that is `https://reinvent-compass.vegas/api/passkit`. A separate `pass.reinvent-compass.vegas` host was considered and dropped (owner decision): one address is simpler to run and to explain, and the pass-service builds `webServiceURL` from the one base URL and a path, so a second host would have needed a pass-service change for no functional gain. `extra_aliases` stays in the roots and the edge module for a future second name; adding one would also need the prod DNS scoping in the bootstrap widened to that name.
- The CloudFront default domain keeps working, because CloudFront serves it with its own certificate; the release health check keeps using it.
- A changed alias list replaces the certificate (create before destroy), so settle the alias set before passes are issued (prod has the apex only).

## Source

- [Requesting a public certificate](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-public.html), [CloudFront alternate domain names](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html), [Route 53 pricing](https://aws.amazon.com/route53/pricing/).
- ADR-013, ADR-027 item 6, build plan sections 5.2 and 7.
