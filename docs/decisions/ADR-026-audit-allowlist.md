# ADR-026 Audit allowlist for accepted advisories

Status: Accepted, 2026-10-16 (integrator decision during the S0 review gate).

## Context

The CI step `npm audit --omit=dev --audit-level=high` fails the build on any high or critical advisory in the production dependency tree. Three advisories reach the project only through `passkit-generator` (S5's Apple Wallet library), which is the single maintained option for building Apple passes:

- `GHSA-86w9-cpqp-85rv` (node-forge): a signature-verification weakness. passkit-generator does not use the affected verification path.
- `GHSA-6h2x-m376-mqjq` (joi, via passkit-generator): a prototype-pollution class issue. All pass input is pre-validated by the PassFields schema (build plan 5.3) before it reaches passkit-generator, so untrusted keys never flow in.
- `GHSA-wr44-6hxh-3jwq` (joi, via passkit-generator): same class, same mitigation.

There is no upstream release of passkit-generator that drops the affected transitive versions yet. Failing CI on these would block every build with no action the team can take beyond waiting for upstream.

## Decision

Replace the plain `npm audit --omit=dev --audit-level=high` step with a reviewed allowlist, implemented in `.github/scripts/audit-check.mjs`:

- The script runs `npm audit --omit=dev --json`, collects every advisory, and fails on any high or critical advisory whose GHSA id is not on the allowlist.
- The allowlist is exactly the three ids above.
- The allowlisted ids are printed as a warning on every run, so the accepted risk stays visible in the CI log.
- Any new high or critical advisory, from any package, fails the build until it is either fixed or explicitly added here through a new decision.

## Consequences

- The allowlist is reviewed at each release gate and whenever passkit-generator is upgraded. When upstream drops the affected versions, the ids are removed and the plain threshold behaviour returns.
- The allowlist is keyed by advisory id, not by package, so an unrelated new advisory in node-forge or joi is still caught.
- This supersedes the `npm audit --omit=dev --audit-level=high` line in ADR-018 for the `check.yml` job. ADR-018 otherwise stands.
