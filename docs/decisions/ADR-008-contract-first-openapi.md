# ADR-008 Contract first OpenAPI

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The Compass API is written by S5, deployed by S6 and called by S4, all in parallel. API Gateway REST can import an OpenAPI file and validate requests against it. Every stream needs the same types on day 1.

## Decision

- **Single source:** `contracts/compass-api.openapi.yaml`, OpenAPI 3.0.1 (API Gateway REST import supports 3.0). The `x-amazon-apigateway-*` extensions stay in the single source.
- **Byte-identical copies,** checked by SHA-256 in the CI job:
  - `infra/modules/api/openapi.yaml`, fed to `aws_api_gateway_rest_api.body`.
  - `packages/contracts/openapi.yaml`, from which TypeScript types are generated with `openapi-typescript`.
- MCP tool schemas live in `packages/contracts/src/mcp-tools.ts`. `PassFields` lives in `packages/contracts/src/pass-fields.ts` (zod, the single source).
- Errors use `application/problem+json`: `{type, title, status, code}`. Input is never echoed back.
- Locked at the end of day 1 (16 October): `PassFields`, `Session`, `Schedule`, `Commitment`, `Verdict`, the MCP tool schemas, the OpenAPI file and the synthetic catalog.

## Consequences

- Contract changes after day 1 need an S0 change request (ADR-007).
- Pass-service responses are validated against the OpenAPI file in tests.
- A hash mismatch fails CI.

## Source

- re:Invent Compass build plan sections 5.1, 5.3, 9.2, 11.1, 11.2.
- [API Gateway request validation](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-validation.html).
