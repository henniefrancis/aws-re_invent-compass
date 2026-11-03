_For architects: how Compass keeps Apple and Google Wallet passes true to the schedule, how long it keeps pass content, how many prompts it shows, and how the board page offers the passes._

Each section is one decision with four parts: the context, the decision, why, and the trade-off. Where a later decision or the code changed it, the section says so. The [Key decisions](Key-Decisions) page lists every decision on every theme.

## Update, void and expire every pass

**Context:** The owner put Apple's pass update web service in scope: a cancelled reservation's pass must go away, and every pass must expire. Neither Apple Wallet nor Google Wallet lets an issuer delete a pass from someone's phone. The closest is to [void](Glossary#void) or expire it, which moves it out of the main [wallet](Glossary#wallet) view.

**Decision:**

- **Apple:** a [PassKit](Glossary#passkit) web service at the pass's update URL (register, list updatable passes, get the latest pass, unregister, log). Pushes go over [APNs](Glossary#apns) (HTTP/2, production) with the Pass Type ID certificate and an empty payload.
- **Google:** generic pass objects with the id `<issuerId>.<serialNumber>`, updated through the Google Wallet API. No device service is needed.
- **Cancel:** `sync_passes` compares a fresh read of the schedule with the local issued-pass record. A cancelled session goes to `POST /api/v1/passes/{serialNumber}/void`, which is idempotent: the Apple pass is marked voided with its expiry set to now, each registered device gets a push, and the Google object is set to `INACTIVE`.
- **Change:** a new time or room goes to `PUT /api/v1/passes/{serialNumber}` and follows the same push path.
- **Expiry:** every pass expires at its session end on both platforms (Apple `expirationDate`, Google `validTimeInterval.end`).
- **Template:** [boarding closes](Glossary#boarding-closes) 10 minutes before the start, the line "Unofficial. Your badge is your ticket.", sharing prohibited and no barcode ([packages/pass-service/src/apple/pass-template.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/apple/pass-template.ts)).

**Why:** It is the closest either platform allows to deleting a pass, and it keeps every pass on the phone true to the schedule.

**Trade-off:** The server stores device registrations and pass records (see [Personal data on the server](Decisions-Security-and-Privacy#personal-data-on-the-server)). Pushes are best effort; Wallet also refreshes a pass when it is opened, and every pass expires anyway.

**Later:**

- The Apple pass is an `eventTicket`, with no transit type. The first template was a boarding pass with a generic transit type; the owner changed it on 20 October 2026.
- The update URL uses the custom domain, `https://reinvent-compass.vegas/api/passkit` (see [A custom domain for the site and the API](Decisions-Infrastructure#a-custom-domain-for-the-site-and-the-api)).

**Today:** On a real iPhone against dev (19 October 2026), registration, update with a push (within about two minutes) and void all worked. On a real Android phone (31 October 2026), save and void worked, with Google publishing access granted on 21 October, so passes are not limited to test users. The Compass tool results remind the attendee to run `sync_passes` after a change. See [Pass service](Pass-Service).

## Pass content kept until session end plus 24 hours

**Context:** The [cloud hand-off](Decisions-Architecture#cloud-hand-off-to-the-phone) was accepted on the basis of short-lived pass content. But Apple's update service must rebuild the latest pass whenever a device asks, so the server needs the printable fields for as long as the pass can change. A 15-minute window is not enough.

**Decision:**

- The printable pass fields, plus the attendee's name only if they opt in, stay in the DynamoDB pass record until the session ends plus 24 hours.
- Reads treat the record as gone after that time. DynamoDB [TTL](Glossary#ttl) removes it later.
- `forget_me` deletes it earlier on request.

**Why:** It is the minimum the update service needs to work.

**Trade-off:** Pass content stays on the server for longer than "short-lived". The mitigations are few fields, no identity beyond a keyed hash, and `forget_me`.

## One confirmation for issuing passes

**Context:** In Kiro, the owner saw two prompts for `issue_all_boarding_passes`: Kiro's own approval, which always runs for a write tool, and a second question from Compass. The owner's rule: when several passes are issued, one confirmation; when a single pass is issued, one confirmation for that pass.

**Decision:**

- The client's approval of the tool call is the confirmation. `issue_all_boarding_passes` and `issue_boarding_pass` do not ask again ([packages/mcp-server/src/tools/issue-boarding-passes.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/tools/issue-boarding-passes.ts)).
- `issue_boarding_pass` without a session id still asks which reserved session. That question picks a session; it does not confirm anything.
- Both tools are write tools and must never be auto-approved.
- The safeguards stay: a pass is issued only for a session that a fresh read of the schedule lists as reserved, an unknown or malformed session id is refused before any pass call, each session is refreshed first so the pass has current times, and the reply says the pass is unofficial and the badge is the ticket.

**Why:** One prompt instead of two, and issuing a pass changes nothing in the re:Invent schedule.

**Trade-off:** The confirmation now depends on the client showing an approval for a write tool. A client that auto-approves everything would issue passes with no prompt; Compass cannot force a client to ask. The schedule writes, `send_to_phone`, `sync_passes` and `forget_me` keep their own confirmations.

## Board page buttons at the top or on each session

**Context:** The board page offers Apple Wallet, Google Wallet and a calendar file for a week that may hold 2 sessions or more than 20. Each wallet limits how many passes one tap can add:

- **Google:** a save button is a link carrying a signed token, and Google gives 1,800 characters as the safe length. Compass inserts each pass object through the API first, so the token only names ids. Measured with production-length ids, 8 passes gave 1,782 and 1,796 characters, 9 passes gave 1,930, and one pass about 730 to 750.
- **Apple:** a `.pkpasses` bundle adds several passes in one tap. Apple states no maximum; a developer forum report says bundles over 10 failed in Safari. Each Compass pass is about 400 KB, so 10 passes come close to Lambda's 6 MB response limit once base64-encoded.
- **Calendar:** one `.ics` file holds the whole week with no limit.

**Decision:**

- **8 sessions or fewer:** buttons at the top only, one Apple bundle, one Google link and one calendar file.
- **More than 8:** an Apple and a Google button on each session, for that one pass. The top keeps only the calendar file for the week.
- The threshold of 8 and the bundle cap of 10 are named constants in the pass service ([packages/pass-service/src/services/handoff-service.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/services/handoff-service.ts), [packages/pass-service/src/apple/pass-signer.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/apple/pass-signer.ts)). The Google client also measures every signed token against the safe length.
- If the single Google link cannot be made, the Google buttons move onto the sessions that have a Google object, so no pass loses its Google button.
- Only the phone's own wallet: an iPhone sees only Apple buttons and an Android phone only Google buttons. Every other device sees both, and the calendar button always shows. The check reads the browser's own description of the device, on the device, and sends nothing ([site/src/lib/board/device.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/device.ts)).
- The pass service decides: the hand-off view returns either the top actions or the per-session ones, and one route serves a single Apple pass.

**Why:** No Google link goes over Google's safe length, no Apple bundle goes over 10 passes or the Lambda limit, and the page never offers two ways to do the same thing.

**Trade-off:** A long week takes one tap per session per wallet. Not confirmed: a 10-pass bundle on a real iPhone (a two-pass bundle was tested), and the exact point at which a longer Google link fails on current Android phones.

## Related pages

- [Key decisions](Key-Decisions)
- [Pass service](Pass-Service)
- [User guide: Board](User-Guide-Board)
- [Pass API](Pass-API)
- [Decisions: Architecture](Decisions-Architecture)
