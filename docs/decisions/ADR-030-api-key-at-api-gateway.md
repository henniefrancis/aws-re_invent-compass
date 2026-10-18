# ADR-030 API key enforced at API Gateway

Status: Accepted, 2026-10-17 (integrator, from the S5 and S6 security reviews).

## Context

The Compass API runs on API Gateway REST behind CloudFront and WAF. The regional `execute-api` URL cannot be switched off without a custom domain, so a direct call skips WAF, the rate rules and the kill switch. The Lambdas already refuse requests without the CloudFront origin-verify header, but each direct call still invokes a Lambda.

## Decision

- The contract (`contracts/compass-api.openapi.yaml`) adds an `api_key` scheme (header `x-api-key`, `x-amazon-apigateway-api-key-source: HEADER`) to every one of the 15 methods. API Gateway enforces it before any Lambda runs.
- CloudFront injects the key as a custom origin header and overwrites any viewer-supplied value. Viewers never see or send it.
- The `bearerIdToken` and `applePass` schemes stay documentation only; those credentials are verified inside the Lambdas.
- The origin-verify check stays as defence in depth.

## Consequences

- A direct call to the `execute-api` URL is rejected with 403 by API Gateway.
- The API key value is in the CloudFront configuration and HCP Terraform state (accepted in ADR-027 item 2), and is rotated with the origin-verify value.
- The three contract copies stay byte-identical (hash check).

## Source

- Commit 6ffe3fd on develop.
- S6 security review (M1) and S5 security reviews, 17 October 2026.
