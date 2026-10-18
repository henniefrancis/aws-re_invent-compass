# ADR-019 Google Wallet key in Secrets Manager

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The Compass API calls the Google Wallet API to insert and patch pass objects and to sign save JWTs. It needs a Google credential at runtime. Secrets must never be committed, output by Terraform or echoed.

## Decision

- The Google Wallet service account key is stored in the Secrets Manager secret `compass/<env>/google-wallet`.
- Terraform creates the secret; the owner loads the value out of band with `scripts/load-secrets.sh` (reads from files, never echoes), following the runbook.
- The Lambdas resolve the secret at runtime and cache it.
- The Google issuer and class are created by an idempotent owner-run `scripts/google-wallet-class.mjs`, not by Terraform.
- Workload identity federation is a later improvement.

## Consequences

- The secret is a retained resource (ADR-015).
- It costs USD 0.40 a month.
- The key is a stored credential until workload identity federation replaces it.

## Source

- re:Invent Compass build plan sections 6, 7.2, 7.3, 7.4, 8 (S5, S6), 15.
