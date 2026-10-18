# ADR-031 Custom domain reinvent-compass.vegas

Status: Accepted, 2026-10-18 (owner decision). Amends ADR-002 and ADR-013 (the address of the public edge) and resolves ADR-027 item 6.

## Context

The public edge was planned on the CloudFront default address, `https://<distribution>.cloudfront.net`. That address is baked into every issued pass (`webServiceURL`) and into the npm package, and its default certificate lets viewers use TLS 1.0 (ADR-027 item 6). The owner registered `reinvent-compass.vegas`; its DNS is a Route 53 hosted zone in the same AWS account, created with the registration.

## Decision

- **One custom domain for the whole site.**
  - prod: the site, `/board` and the API on `reinvent-compass.vegas`, plus `pass.reinvent-compass.vegas` as a second alias on the same distribution.
  - dev: `dev.reinvent-compass.vegas` only.
- **Variables in each environment root:** `domain_name`, `extra_aliases` (both nullable: null keeps the CloudFront default domain and the old behaviour exactly) and `hosted_zone_name` (`reinvent-compass.vegas`).
- **The edge module** requests an ACM certificate in us-east-1 for the aliases, validates it with DNS records created in the existing zone, waits for the validation, sets the distribution `aliases` and `viewer_certificate` (the ACM certificate, SNI only, `TLSv1.2_2021`), and adds Route 53 A and AAAA alias records for each name.
- **The zone is read, not managed.** It was created with the domain registration, so Terraform reads it through a data source. Under the golden rule the owner can later bring it under Terraform with `terraform import`; the data source then becomes a resource.
- **PUBLIC_BASE_URL is derived** from the custom domain (`https://<domain_name>`), which removes the two-apply step (the distribution depended on the Lambdas, and the Lambdas needed the distribution address). An explicit `public_base_url` still wins, and with no domain the old path stays.
- **Least privilege.** The apply role may request, tag and delete ACM certificates only with the project and environment tags, and may change Route 53 records in that one zone only, for its own environment's names and for the A, AAAA and CNAME types (dev owns `dev.<zone>`, prod owns the apex and `pass.<zone>`, each with its certificate validation records). The plan role reads the zone, its records and the certificates. `release.sh` allows the new resource types.

## Consequences

- ADR-027 item 6 is resolved: viewers get TLS 1.2 or later on the custom domain.
- Cost: ACM public certificates are free; a Route 53 hosted zone costs about USD 0.50 a month plus query charges (a few cents at this scale). The domain registration is paid separately.
- The registrar must delegate the domain to the zone name servers, or the certificate never validates and the first apply waits on it. That is the one precondition the runbook checks.
- **Pass host.** `pass.reinvent-compass.vegas` is a working second alias on the distribution, but the pass-service builds `webServiceURL` as `PUBLIC_BASE_URL` plus `PASSKIT_WEB_SERVICE_PATH` (a path only) and has no separate host setting. Passes therefore carry `https://reinvent-compass.vegas/api/passkit` unless the pass-service gains a setting for the pass base URL (for example `PASSKIT_WEB_SERVICE_BASE_URL`), or `public_base_url` is set to the pass host, which would also make `boardUrl` point at the pass host. This is an open request to the pass-service stream; the infrastructure needs no change when it lands, except passing the new value.
- The CloudFront default domain keeps working, because CloudFront serves it with its own certificate; the release health check keeps using it.
- A changed alias list replaces the certificate (create before destroy), so the alias set of prod should be settled before passes are issued.

## Source

- [Requesting a public certificate](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-public.html), [CloudFront alternate domain names](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html), [Route 53 pricing](https://aws.amazon.com/route53/pricing/).
- ADR-013, ADR-027 item 6, build plan sections 5.2 and 7.
