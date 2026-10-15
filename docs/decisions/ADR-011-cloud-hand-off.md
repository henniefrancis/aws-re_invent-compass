# ADR-011 Cloud hand-off

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

Passes are made on the computer but needed on the phone. The owner chose a cloud hand-off for a smoother experience, accepting short-lived server-side pass content (ADR-004 item 5). S3 lifecycle rules work in days, which is too coarse for a 15-minute hand-off.

## Decision

- `POST /api/v1/handoffs` (ID token) takes 1 to 80 serials and returns `{handoffId, boardUrl, expiresAt}`. Compass prints the QR code in the terminal and chat.
- `handoffId` is 16 random bytes, base64url (128 bits). It sits in the URL **fragment** (`/board#h=`), so it is never sent to CloudFront. Only its hash is stored.
- The site's static `/board` page validates the fragment (base64url, 22 chars) and calls `GET /api/v1/handoffs/{handoffId}`.
- The hand-off expires after **15 minutes**, enforced in code; TTL only cleans up. Unknown and expired ids get the same 404.
- Apple gets `.pkpasses` bundles of up to 10 passes each; Google gets a save URL; `calendar.ics` is optional.
- Bundles are **signed on demand** from the DynamoDB pass record. Nothing is stored as a blob.
- Limit: 10 hand-offs per hour per `subHash`. WAF rate rule against enumeration. Strict CSP on `/board`.

## Consequences

- No S3 hand-off bucket and no presigned URLs (rejected).
- The hand-off only gives the serials the attendee chose.
- Cut-list item 5 turns off `.ics` through the hand-off (404 "not enabled"); `.ics` stays a local file.
- The hand-off is on the never-cut list.

## Source

- re:Invent Compass build plan sections 3.3, 3.4, 4.1, 4.3, 5.2, 12.
- [S3 expiry](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).
