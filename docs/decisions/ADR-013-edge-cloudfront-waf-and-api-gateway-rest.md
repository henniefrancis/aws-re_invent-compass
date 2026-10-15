# ADR-013 Edge CloudFront WAF and API Gateway REST

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The site and the Compass API need one public address, protection and request validation at low cost. Apple Wallet's registration POST cannot send `x-amz-content-sha256`, which rules out a Lambda function URL behind OAC. There is no custom domain yet, so CloudFront default addresses are used (ADR-003).

## Decision

- **One CloudFront distribution** at `https://<distribution>.cloudfront.net`: `/` goes to the private S3 site bucket through OAC; `/api/*` goes to API Gateway stage `live`.
- **API Gateway REST** (regional), imported from the OpenAPI file with request validation, stage and method throttling, binary media types for `.pkpass`, and access logs with the template path and no IP.
- Caching disabled for `/api/*` (managed `CachingDisabled` and `AllViewerExceptHostHeader` policies).
- **WAF at CloudFront** (CLOUDFRONT scope, us-east-1): per-IP rate rule, `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, `AWSManagedRulesAmazonIpReputationList`, a kill-switch rule. Logging off; sampling off on API rules.
- **Origin-verify:** CloudFront adds an `x-origin-verify` header; the Lambda checks it, so the `execute-api` URL is shielded without a second WAF.
- Response headers policy: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.

## Consequences

- Rejected: HTTP API (no request validation), Lambda function URL with OAC, a regional WAF on API Gateway (cost).
- The distribution domain is baked into every pass, so it is retained (ADR-015).
- WAF costs about USD 10.10 a month (ADR-021 may remove it).

## Source

- re:Invent Compass build plan sections 3.2, 3.4, 4.1, 5.2, 6, 7.2, 7.4.
- [Request validation](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-validation.html), [Binary payloads](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-payload-encodings.html), [REST vs HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html), [Lambda function URL with OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html), [WAF resources](https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html), [Managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html).
