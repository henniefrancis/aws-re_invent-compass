# ADR-023 Events API OpenAPI source

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

S0 commits the official AWS Events API OpenAPI document so every stream generates its Events API types from one accurate source. ADR-008 makes the project contract first, and the committed Events API document is the upstream source for the generated Events API types. The fetch is a one-time operator action, not a CI or test action: CI never calls the live API, so the document is pinned in the repository and treated as the shared truth for Events API shapes.

## Decision

Record the provenance of the committed Events API OpenAPI document explicitly:

- Committed path: `packages/contracts/events-api.openapi.json`
- Source URL: https://api.awsevents.com/v1/openapi.json
- Retrieval date (UTC, ISO 8601): 2026-10-15
- OpenAPI version: 3.1.0
- Document title and version: "AWS Events API", version 1.0.0
- Byte size: 100531 bytes
- SHA-256 (hex): b8591c1bb9bcf9f40871f3af19b8418f39fc527f7e8692e7ef1d533ca9638d82

The document is refreshed only by an operator rerunning the fetch helper at `packages/contracts/scripts/fetch-events-api.mjs`. Any refresh that changes the document updates this ADR's SHA-256 in the same change, so this record always names the hash of the file currently committed.

## Consequences

- The generated Events API types and the shared wire schemas mirror this exact document, so every stream reads one accurate shape.
- A drift is caught because the committed document and the SHA-256 recorded here must match: a test asserts that this ADR contains a SHA-256 equal to the hash of the committed document.

## Source

- re:Invent Compass build plan, S0 stream, Requirement 3 (Events API OpenAPI retrieval, recording and type generation).
- [AWS Events API developer guide](https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html).
