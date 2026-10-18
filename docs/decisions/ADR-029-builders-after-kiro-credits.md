# ADR-029 Builders after the Kiro credits ran out

Status: Accepted, 2026-10-17 (owner decision).

## Context

The project is spec driven with Kiro (ADR-004, `KIRO-SPEC-PROMPTS.md`). On 17 October 2026 the owner's Kiro credits ran out. By then Kiro had written the S0, S1, S2, S4 and S6 specs and built S0 and S1 tasks 1 to 8. The submit target is 1 November.

## Decision

- Claude's dev-team agents (developer, QA, security, technical account manager and CTO roles) build the remaining work from the same Kiro specs, under the same steering, ownership and review gates, one agent per worktree.
- The S3, S5 and S7 specs are written by Claude in Kiro's format (requirements, design, tasks), with the spike fallbacks built in, and reviewed by the CTO and security roles before any code.
- The specs, `tasks.md` checkboxes and `design.md` deviation sections stay the single record, so Kiro can pick up any stream when credits renew.
- The owner is the sole commit author. Claude is credited in the project description, the README and the Builder Center article.

## Consequences

- The Builder Center article tells this story honestly: the specs carried the project when the tool that wrote them was unavailable.
- Every stream passed QA, security and closure checks before it merged, and the release gate added TAM and CTO reviews.

## Source

- `KIRO-SPEC-PROMPTS.md` ("Builders from 17 Oct").
- Owner instructions, 17 October 2026.
