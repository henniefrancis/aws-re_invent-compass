# ADR-009 Attendee-only Compass API

Status: Accepted, 2026-10-15 (owner approved the build plan). The per-pass manage-token fallback below is the alternative if the day-1 spike SP2 fails.

## Context

Passes must be signed server-side, and only attendees should be able to use the signer. Compass must not send the Events API access token to its own server. The owner chose an attendee-only signer that verifies the Builder ID ID token (ADR-004 item 4). Abuse by any Builder ID holder is a risk, because sign-up is free (R7).

## Decision

- The signer is now the **Compass API**. Compass sends the Builder ID **ID token** as a bearer token. The access token never leaves the attendee's machine.
- Verification with `aws-jwt-verify`: signature against JWKS (cached per `kid`), `iss`, `aud = 7vmom55m1qstvq8i71ph127bfq`, `token_use = id`, `exp`, RS256 only.
  - Expected: a Cognito user pool issuer, verified with `CognitoJwtVerifier` (`tokenUse: "id"`, `clientId`).
  - Another OIDC issuer with a public JWKS: the generic `JwtVerifier`, with pinned `iss`, `aud` and RS256.
- The token is never logged or stored. The `email` claim is never read. Only `subHash` is kept (ADR-012).
- Per-`subHash` limits: 60 pass writes per hour, 10 hand-offs per hour, 80 active passes.
- Update, void and download check that the record's `subHash` matches the caller.

## Alternative (if SP2 fails)

Issuance runs unauthenticated, with a stricter per-IP WAF rule (60 requests per 5 minutes on `POST /api/v1/passes*`). Update, void and download are authorised by a per-pass `manageToken`: 32 random bytes held in the local issued-pass record, with only its hash stored on the server. This needs a new owner decision.

## Consequences

- Abuse controls: WAF per-IP rate rule, stage and method throttling, event-window and content rules, a kill switch and a budget alarm.
- JWT negative tests (wrong `aud`, `iss`, `alg: none`, expired, unknown `kid`) are required.

## Source

- re:Invent Compass build plan sections 3.2, 3.4, 4.3, 5.4, 10 (SP2), 13 (R7, R8).
- [Cognito JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html).
