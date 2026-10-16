# ADR-015 Retained resources

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

Some resources cannot be replaced without harm. The CloudFront domain is baked into every issued pass and the npm package's default API URL. The table holds live device registrations. Secrets have a deletion recovery window that blocks re-creating the same name.

## Decision

These resources have `prevent_destroy`, and `release.sh` refuses any plan that replaces or destroys them:

| Resource                | Roll-forward note                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CloudFront distribution | If lost, issued passes stop updating; attendees reissue through `sync_passes --reissue-all`.                           |
| DynamoDB table          | Deletion protection plus PITR. Restore into a new table, then `terraform import` (owner) and switch the name variable. |
| Secrets (3)             | Restore inside the recovery window with an owner-run `restore-secret`, then `terraform import`.                        |
| Site bucket             | Reproducible; retained only so a mistaken plan does not take the site down.                                            |

## Consequences

- The roll-forward notes live in the rollback runbook.
- S6 tests assert `prevent_destroy`.
- Rollback never destroys these resources; it re-runs `release.sh` with the previous commit's bundle.

## Source

- re:Invent Compass build plan sections 7.2, 7.3, 8 (S6), 11.3, 13 (R10).
