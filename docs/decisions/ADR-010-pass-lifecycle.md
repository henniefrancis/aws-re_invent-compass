# ADR-010 Pass lifecycle

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The owner moved Apple's pass update web service into scope: a cancelled reservation's pass must go away, and every pass must expire (ADR-004, pass lifecycle). Neither Apple Wallet nor Google Wallet lets an issuer delete a pass from a phone. The closest is to void or expire it, which moves it to Expired.

## Decision

- **Apple:** a PassKit web service at `webServiceURL` `https://<distribution>.cloudfront.net/api/passkit` (register, list updatable, get latest pass, unregister, log). Pushes go over APNs (HTTP/2, production) with the Pass Type ID certificate and an empty JSON payload.
- **Google:** generic objects with id `<issuerId>.<serialNumber>`, updated through the Google Wallet API. No device service.
- **Cancel:** `sync_passes` runs after every write and compares `GetSchedule` with the issued-pass record. A cancelled session goes to `POST /api/v1/passes/{serial}/void` (idempotent): `voided: true`, `expirationDate: now`, `lastUpdated` bumped, push to each registered device, Google object patched to `state: INACTIVE`.
- **Change:** a new time or room goes to `PUT /api/v1/passes/{serial}` and follows the same push path.
- **Expiry:** every pass carries `expirationDate` (Apple) and `validTimeInterval.end` (Google) set to the session end.
- Pass template: `boardingClosesAt = startsAt - 10 min`, disclaimer "Unofficial. Your badge is your ticket.", `transitType = PKTransitTypeGeneric`, `sharingProhibited = true`, no barcode.

## Consequences

- The server stores device registrations and pass records (ADR-012, ADR-022).
- Pushes are best effort; Wallet also refreshes when the pass is opened. If APNs fails (SP3), passes still expire and sync tells the attendee which pass to delete.
- Google ships as "beta, test users" if publishing access is not granted by 28 Oct (SP4).
- Never cut: Apple passes with void on cancel and expiry at session end. Cut-list items 6, 9 and 10 trim `PUT` and Google.

## Source

- re:Invent Compass build plan sections 3.3, 3.4, 5.2, 5.3, 10 (SP3, SP4), 12.
- Apple: [Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes), [Register](https://developer.apple.com/documentation/walletpasses/register-a-pass-for-update-notifications), [Get updatable passes](https://developer.apple.com/documentation/walletpasses/get-the-list-of-updatable-passes), [Send an updated pass](https://developer.apple.com/documentation/walletpasses/send-an-updated-pass), [Unregister](https://developer.apple.com/documentation/walletpasses/unregister-a-pass-for-update-notifications), [Log a message](https://developer.apple.com/documentation/walletpasses/log-a-message), [Pass keys](https://developer.apple.com/documentation/walletpasses/pass), [Distributing and updating a pass](https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass), [Apple Support 102544](https://support.apple.com/en-us/102544).
- Google: [GenericObject](https://developers.google.com/wallet/generic/rest/v1/genericobject).
