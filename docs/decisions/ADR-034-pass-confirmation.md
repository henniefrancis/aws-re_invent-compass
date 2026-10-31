# ADR-034 One confirmation for issuing passes

Status: Accepted, 2026-10-29 (owner rule of 21 October 2026; compass-power task 52). Takes precedence over "after one confirmation" in P4.1 and P4.2.

## Context

In Kiro the owner saw two prompts for `issue_all_boarding_passes`: Kiro's own tool approval, which always runs for a write tool, and Compass's own `humanConfirms` question. The owner's rule (requirement P4.5): "when multiple passes are issued, only 1 confirm, when single passes are issued, each confirm".

## Decision

- **The client's approval is the confirmation.** `issue_all_boarding_passes` and `issue_boarding_pass` no longer call `humanConfirms`. One approval covers all passes, and one approval covers a single pass.
- **The pick list stays.** `issue_boarding_pass` without a `sessionId` still asks which reserved session, through the client's choice prompt. That question picks a session. It does not confirm anything. A client that cannot ask gets the reserved list and a line telling the attendee to name one session.
- **Never auto-approve.** The two tools are write tools and stay out of the recommended `autoApprove` list. The Power still says never to auto-approve either tool, and the descriptions say the client's approval is the confirmation.
- **Safeguards that remain.** A pass is issued only for a session the freshly read schedule lists as reserved. A session id that fails the identifier check or is unknown is refused before any pass call. Each session is refreshed with `GetSession` first, so the pass has current times. The reply says the pass is unofficial and that the badge is the ticket.
- **Scope of the rule.** Issuing a pass changes no re:Invent schedule. The schedule writes, `send_to_phone`, `sync_passes` and `forget_me` keep their own confirmations.

## Consequences

- One prompt instead of two in Kiro. The confirmation now depends on the client showing an approval for a write tool. A client that auto-approves everything would issue passes with no prompt. The Power guidance and the write class of the tools are the controls. Compass cannot force a client to ask.
- The tests in task 52 check that neither tool asks a confirmation through elicitation, that the pick list is the only question without an id, and that over MCP with an elicitation client the only question is the pick list. This ADR did not re-run them.

## Source

- `.kiro/specs/compass-power/design.md` ("One confirmation for passes"), `requirements.md` P4.5, `tasks.md` task 52.
- `packages/mcp-server/src/tools/issue-boarding-passes.ts`.
