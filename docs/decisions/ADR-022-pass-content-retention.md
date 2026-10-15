# ADR-022 Pass content retention

Status: Accepted, 2026-10-15 (owner approved the build plan, including assumption A1).

## Context

The cloud hand-off was accepted on the basis of short-lived pass content (ADR-004 item 5). But Apple's update service must rebuild the latest pass whenever a device asks, so the server needs the printable pass fields for as long as the pass can change. A 15-minute hand-off window is not enough.

## Decision

- The printable pass fields (`PassFields`, plus the attendee name only if opted in) are kept in the DynamoDB pass record **until session end plus 24 hours**, at most about 5 December 2026.
- This is the minimum the update service needs.
- Reads treat the record as gone after `expiresAt`; DynamoDB TTL removes it later.
- `forget_me` deletes it earlier on request (ADR-012).

## Consequences

- Pass content stays on the server for longer than "short-lived" (risk R16: certain likelihood, low impact).
- Mitigations: minimal fields, no identity beyond `subHash`, `forget_me`.
- The POPIA record lists it as field P10.

## Source

- re:Invent Compass build plan status line, sections 2 (A1), 3.3, 4.2 (P10), 13 (R16).
- [Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes).
