# ADR-016 Synthetic catalog

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The product uses real, live data. It is not yet known whether a real catalog snapshot may be published, so tests and the public demo use made-up sessions with the real data shape (ADR-004 item 6). CI must never call the live API.

## Decision

- S0 builds a **synthetic catalog generator plus a 120-session catalog** in the real shape, under `fixtures/synthetic/**`. It validates against the same zod schemas used for live data.
- The synthetic catalog feeds the unit and fixture tests, simulated mode (`COMPASS_MODE=simulated`) and the site demo.
- **Real recordings stay private:** in spike SP5 the owner records the live API into `fixtures/.raw/` (git-ignored). A script diffs its shape against the synthetic catalog and the official OpenAPI.
- Live smoke tests run only behind `COMPASS_LIVE_TESTS=1`, by the owner, locally.
- This stays until AWS confirms a snapshot may be published (owner task O7).

## Consequences

- Shape differences found by SP5 adjust the contracts before 17 October.
- Judges and non-attendees can try the full flow without a live account.

## Source

- re:Invent Compass build plan sections 8 (S0, S1), 10 (SP5), 11.2, 14 (O7).
- [AWS Events REST API](https://docs.aws.amazon.com/events/latest/devguide/rest-api.html).
