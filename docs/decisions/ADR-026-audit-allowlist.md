# ADR-026 Audit allowlist for accepted advisories

Status: Accepted, 2026-10-16 (owner accepted the integrator's recommendation during the S0 review gate).

## Context

The CI step `npm audit --omit=dev --audit-level=high` fails the build on any high or critical advisory in the production dependency tree. On 16 October 2026 it reported three advisories, all reaching the project only through `passkit-generator` 3.7.0 (S5's Apple Wallet library):

- `GHSA-86w9-cpqp-85rv` (node-forge <= 1.4.0, high, no patched version): RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements. passkit-generator only creates signatures (`forge.pkcs7.create`, signing with the Pass Type ID key); the integrator checked its code and it never calls node-forge signature verification, so the affected path is not used.
- `GHSA-6h2x-m376-mqjq` (joi < 17.13.7, high): quadratic regular-expression backtracking in `Joi.string().isoDate()` (a denial-of-service class issue). Every value reaching passkit-generator is first validated by the PassFields schema (build plan 5.3), which enforces a strict ISO 8601 pattern and short maximum lengths, so attacker-sized input cannot reach joi.
- `GHSA-wr44-6hxh-3jwq` (joi < 17.13.8, medium in the advisory, reported under the high group by npm): prototype replacement through `__proto__` error codes in message compilation. passkit-generator compiles only its own fixed schemas and messages; no attacker-controlled message or schema reaches joi.

passkit-generator pins `joi` exactly at 17.13.4. `joi` 17.13.8 (published 16 October 2026) fixes both joi advisories, but an npm `overrides` entry for it did not take effect with npm 11 (npm removed joi instead of upgrading it), so the integrator reverted that attempt.

## Decision

Replace the plain `npm audit --omit=dev --audit-level=high` step with a reviewed allowlist, implemented in `.github/scripts/audit-check.mjs`:

- The script runs `npm audit --omit=dev --json` and fails on any high or critical advisory whose GHSA id is not on the allowlist.
- The allowlist is exactly the three ids above, keyed by advisory id, not by package, so any new advisory in node-forge, joi or anything else still fails the build.
- The allowlisted ids are printed as a warning on every run, so the accepted risk stays visible in the CI log.

## Consequences

- S5's security review re-checks this decision once the pass service code exists.
- Remove the two joi ids as soon as passkit-generator ships with joi 17.13.8 or later, or once an npm override to 17.13.8 resolves correctly. Remove the node-forge id when a patched node-forge is released and reaches passkit-generator.
- The allowlist is reviewed at every release gate and whenever passkit-generator is upgraded.
- This supersedes the `npm audit --omit=dev --audit-level=high` line in ADR-018 for the `check.yml` job. ADR-018 otherwise stands.
