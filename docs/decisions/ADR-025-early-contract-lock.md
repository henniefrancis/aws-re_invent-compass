# ADR-025 Early contract lock

Status: Accepted, 2026-10-16 (owner).

## Context

The build plan (section 9.2) locks the S0 foundation in one day before the other streams start. On 16 October, S0 task 4 alone took over two hours in Kiro, and eleven tasks remained. Waiting for the whole of S0 would slip every other stream by about a day and push the 28 October feature freeze.

The other streams need the shared contracts to start, not the whole of S0: the wire and domain schemas, PassFields, the MCP tool schemas, and the Compass API OpenAPI contract with its generated types.

## Decision

- Kiro runs S0 tasks 5, 6 (checkpoint) and 7 next, then stops.
- Claude reviews them at checkpoint 6 and merges `feature/foundation-contracts` into `develop` as the **contract lock**.
- The S1 to S6 worktrees are then cut from `develop` and start.
- Kiro finishes the rest of S0 (tasks 8 to 15: scanners, synthetic catalog, spikes, CI workflows, save hook, example files, acceptance gate) on the same branch. Claude merges it into `develop` again when it passes review.

## Consequences

- File ownership is unchanged: S0 still owns `.github/**`, `fixtures/synthetic/**`, `spikes/**` and `.kiro/hooks/**`, which no other stream touches.
- Streams that start before the synthetic catalog lands (task 9) use small local test data inside their own folders, and switch to the shared catalog once it is merged.
- The contracts are frozen at the lock. Any later change goes through an S0 change request that every stream rebases onto (plan section 9.1).
- Supersedes the "S0 must be merged before any other spec starts" line in KIRO-SPEC-PROMPTS.md, for the contract part only.

## Source

- Owner decision, 2026-10-16. Build plan sections 9.1, 9.2 and 9.3. Contract lock merged into develop as 9b2b813 on 2026-10-16.
