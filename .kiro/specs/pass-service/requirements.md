# Requirements Document

## Introduction

This spec (S5, pass-service) covers the Compass API Lambdas of re:Invent Compass: the small serverless service in the owner's AWS account that signs unofficial Apple Wallet and Google Wallet boarding passes for signed-in attendees, runs Apple's PassKit web service so issued passes stay current, pushes updates over APNs, patches Google Wallet objects, and serves the 15-minute hand-off that moves passes from the attendee's computer to their phone. It owns `packages/pass-service/**` and its tests under `packages/pass-service/test/**`.

In the airline metaphor this stream is the gate agent's printer and the airline's flight-status service behind it. It prints a boarding pass only for a verified passenger (the Builder ID ID token), refuses to print anything that looks like a forged ticket (fixed template, strict content rules), tells every phone holding a pass when the flight changes or is cancelled (APNs and Google patches), and lets the passenger pick up their passes at a self-service kiosk for 15 minutes (the hand-off).

Infrastructure is out of scope: S6 owns all Terraform, the API Gateway import, the DynamoDB table, the secrets containers, the IAM roles and the alarms. S5 delivers two Lambda bundles (`api` and `passkit`), their handler names, their documented environment variables, the JSON layout of each secret, the DynamoDB key schema it reads and writes, and the metrics it emits. The Compass API contract (`contracts/compass-api.openapi.yaml`, 15 operations) and the shared schemas in `@compass/contracts` are frozen and owned by S0; this stream never edits them.

Three day-1 spikes have not yet been run (SP2 ID token issuer, SP3 PassKit on a real iPhone, SP4 Google Wallet demo mode). This spec designs for the build plan's expected outcome and puts each assumption behind configuration, so a spike result changes configuration, not code.

Scope boundary: this stream does not build the local pass builder, sync or Compass API client (S4), the MCP tools (S3), the `/board` page (S7), or any Terraform, script or runbook (S6). It never signs in an attendee and never sees the Events API access token.

## Glossary

- **Compass_API**: The attendee-only HTTP API defined by `contracts/compass-api.openapi.yaml`, served at `https://<distribution>.cloudfront.net/api/*` through API Gateway REST stage `live`.
- **Api_Lambda**: The Lambda bundle that serves the ten attendee, hand-off and health operations: getHealth, issuePasses, getApplePass, updatePass, voidPass, createHandoff, getHandoff, getHandoffAppleBundle, getHandoffCalendar and forgetMe.
- **Passkit_Lambda**: The Lambda bundle that serves the five Apple PassKit web service operations: registerDevice, unregisterDevice, getSerialNumbers, getLatestPass and logMessages.
- **Route_Template**: The API Gateway resource path template of a request (for example `/api/v1/passes/{serialNumber}/void`), read from the proxy event `resource` field. It never contains an identifier value.
- **Problem_Response**: An `application/problem+json` body of exactly `{type, title, status, code}` that validates against `ProblemSchema` from `@compass/contracts`.
- **Origin_Guard**: The check that the `x-origin-verify` request header equals the origin-verify value held in Secrets Manager.
- **ID_Token**: The AWS Builder ID ID token (JWT) sent as `Authorization: Bearer <token>` on attendee routes.
- **Token_Verifier**: The component that verifies an ID_Token with `aws-jwt-verify`.
- **Verifier_Mode**: The configuration switch that selects `cognito` (CognitoJwtVerifier, the expected SP2 outcome) or `oidc` (the generic JwtVerifier, build plan 5.4 step 2).
- **Pepper**: The HMAC key held in the `compass/<env>/app` secret.
- **SubHash**: HMAC-SHA256 of the ID_Token `sub` claim with the Pepper, hex encoded. The only identity the service stores.
- **DeviceHash**: HMAC-SHA256 of Apple's `deviceLibraryIdentifier` with the Pepper, hex encoded.
- **Serial_Number**: A UUID v4 generated server-side for each pass.
- **Auth_Token**: The Apple `authenticationToken` embedded in a pass: 32 bytes, base64url without padding (43 characters).
- **Handoff_Id**: 16 random bytes, base64url without padding (22 characters), carried in the board URL fragment.
- **Pass_Record**: The DynamoDB item for one pass (personal data record P10).
- **Device_Registration**: The DynamoDB item linking a DeviceHash, a push token and a Serial_Number (record P11).
- **Handoff_Record**: The DynamoDB item for one hand-off (record P12).
- **Rate_Counter**: The DynamoDB item counting one SubHash's writes or hand-offs in one window (record P13).
- **Expires_At**: The instant after which a stored item is treated as absent on every read, whether or not DynamoDB TTL has removed it.
- **Event_Window**: The event start and end instants and the event timezone, supplied to the Lambdas as configuration set from `GetEvent`.
- **PassFields**: The client-supplied pass content, validated with `createPassFieldsSchema` from `@compass/contracts`.
- **Apple_Pass**: A signed `.pkpass` file (`application/vnd.apple.pkpass`) built with `passkit-generator` 3.7.0.
- **Apple_Bundle**: A `.pkpasses` file (`application/vnd.apple.pkpasses`) holding up to 10 Apple_Passes.
- **Web_Service_URL**: The `webServiceURL` key of every Apple_Pass, built from configuration.
- **Last_Updated**: The per-pass update instant, used for the `lastUpdated` tag and the `Last-Modified` header.
- **APNs_Client**: The HTTP/2 client that sends pass update pushes to `api.push.apple.com` with the Pass Type ID certificate.
- **Google_Wallet_Client**: The client that inserts and patches Google Wallet generic objects and signs the Save to Google Wallet JWT.
- **Google_Object_Id**: `<issuerId>.<Serial_Number>`.
- **Secrets_Provider**: The component that reads the three secrets from AWS Secrets Manager at runtime through the Lambda role and caches them.
- **Request_Logger**: The single structured logger. Each line carries only the request id, the method and Route_Template, the status, the latency, the outcome and numeric metric values.
- **Throwaway_PKI**: Certificates and keys generated in memory at test time to stand in for the Apple WWDR certificate, the Pass Type ID certificate and key, the Google service account key and the ID token signing keys.
- **Owner**: Hennie Francis, the project owner, who runs every spike, deploy and real-device check.

## Requirements

### Requirement 1: Two Lambda bundles

**User Story:** As the infrastructure engineer (S6), I want two ready-to-deploy Lambda bundles with fixed paths, handler names and documented settings, so that Terraform can deploy the Compass API without reading S5's code.

#### Acceptance Criteria

1. THE pass-service build SHALL produce exactly two bundles, `packages/pass-service/dist/lambda/api.zip` for the Api_Lambda and `packages/pass-service/dist/lambda/passkit.zip` for the Passkit_Lambda.
2. THE pass-service build SHALL bundle each Lambda with `esbuild` as a single ES module file named `index.mjs` at the root of its zip, targeting Node.js 24, so that the Lambda handler setting is `index.handler`.
3. WHEN the pass-service build runs twice on the same source tree, THE pass-service build SHALL produce byte-identical zip files.
4. THE pass-service build SHALL write zip entries in sorted path order with a fixed timestamp and fixed permissions, and SHALL NOT include source maps, test files, artwork source files or any secret.
5. IF a built zip file is 5 MB or larger, THEN THE pass-service build SHALL fail and report the bundle name and size.
6. THE pass-service build SHALL include every pass artwork image inside the Api_Lambda and Passkit_Lambda bundles, so that no Lambda reads a file outside its bundle at runtime.
7. THE pass-service README SHALL document, for each Lambda, the bundle path, the handler name, the runtime (`nodejs24.x`), the architecture (`arm64`), every environment variable with its meaning and default, the secret JSON keys it reads, the DynamoDB key schema, the CloudWatch metrics it emits and the AWS permissions it needs.

### Requirement 2: Contract conformance

**User Story:** As a client developer (S4, S7), I want every Compass API response to match the frozen OpenAPI contract, so that the generated client and the board page work without surprises.

#### Acceptance Criteria

1. THE Api_Lambda SHALL serve exactly the operations getHealth, issuePasses, getApplePass, updatePass, voidPass, createHandoff, getHandoff, getHandoffAppleBundle, getHandoffCalendar and forgetMe, at the method and Route_Template given for each in `contracts/compass-api.openapi.yaml`.
2. THE Passkit_Lambda SHALL serve exactly the operations registerDevice, unregisterDevice, getSerialNumbers, getLatestPass and logMessages, at the method and Route_Template given for each in `contracts/compass-api.openapi.yaml`.
3. WHEN either Lambda answers an operation, THE Lambda SHALL use only a status code that the contract lists for that operation, except for the Origin_Guard refusal in Requirement 3, a 429 from Requirement 6 only on operations that list 429, and a 500 Problem_Response for an unexpected internal failure.
4. WHEN either Lambda returns a JSON success body, THE Lambda SHALL return a body that validates against the contract response schema for that operation and status.
5. WHEN either Lambda returns an error, THE Lambda SHALL return a Problem_Response with `Content-Type: application/problem+json`, `type` set to `about:blank`, `title` set to the standard reason phrase of the status, `status` set to the status code and `code` set to a stable Compass error code.
6. THE Compass_API SHALL NOT include any part of the request (path values, query values, header values or body content) in any response body or response header.
7. WHEN a Lambda receives a request whose method and Route_Template it does not serve, THE Lambda SHALL return a 404 Problem_Response.
8. WHEN a Lambda returns an Apple_Pass, an Apple_Bundle or a calendar file, THE Lambda SHALL return the bytes base64 encoded with `isBase64Encoded: true` and the content type that the contract lists for that response.
9. THE pass-service SHALL NOT edit `contracts/**` or `packages/contracts/**`.

### Requirement 3: Origin verification

**User Story:** As the owner, I want the Lambdas to answer only requests that came through CloudFront, so that the raw `execute-api` URL cannot bypass the WAF.

#### Acceptance Criteria

1. WHEN a request reaches either Lambda, THE Origin_Guard SHALL compare the `x-origin-verify` header value with the origin-verify value from the `compass/<env>/app` secret in constant time, before any other processing.
2. IF the `x-origin-verify` header is absent or does not equal the origin-verify value, THEN THE Lambda SHALL return a 403 Problem_Response with code `forbidden` and SHALL NOT read the request body, verify any token, or read or write DynamoDB.
3. THE Origin_Guard SHALL apply to every operation of both Lambdas, including getHealth and the PassKit operations.

### Requirement 4: ID token verification

**User Story:** As the owner, I want only signed-in AWS Builder ID holders to issue and manage passes, so that the signer cannot be used by anyone else.

#### Acceptance Criteria

1. WHEN an attendee route (issuePasses, getApplePass, updatePass, voidPass, createHandoff, forgetMe) receives a request, THE Token_Verifier SHALL require an `Authorization` header of the form `Bearer <JWT>`.
2. WHEN Verifier_Mode is `cognito`, THE Token_Verifier SHALL verify the ID_Token with `CognitoJwtVerifier` from `aws-jwt-verify` using the user pool id derived from the configured issuer, `tokenUse` `id` and the configured client id.
3. WHEN Verifier_Mode is `oidc`, THE Token_Verifier SHALL verify the ID_Token with `JwtVerifier` from `aws-jwt-verify` using the configured issuer, the configured client id as the audience and the configured JWKS URI, and SHALL require a `token_use` claim equal to `id`.
4. THE Token_Verifier SHALL accept an ID_Token only when its header `alg` is `RS256`, its signature verifies against a key from the issuer JWKS selected by `kid`, its `iss` equals the configured issuer, its `aud` equals the configured client id (default `7vmom55m1qstvq8i71ph127bfq`), its `token_use` equals `id` and its `exp` is in the future.
5. IF the `Authorization` header is absent or malformed, or the ID_Token has a wrong `aud`, a wrong `iss`, `alg` `none` or any algorithm other than `RS256`, an `exp` in the past, a `kid` not found in the JWKS, a bad signature or a `token_use` other than `id`, THEN THE Lambda SHALL return a 401 Problem_Response with code `unauthorized`, the same body in every case.
6. THE Token_Verifier SHALL cache the JWKS per `kid` for the lifetime of the Lambda execution environment, and SHALL fetch the JWKS again at most once when a token carries a `kid` that is not in the cached JWKS.
7. WHEN an ID_Token is verified, THE Token_Verifier SHALL derive the SubHash from the `sub` claim and SHALL NOT read the `email` claim or any other claim apart from those named in criterion 4 and `sub`.
8. THE Compass_API SHALL NOT store, log or return any ID_Token or `sub` value.
9. THE Token_Verifier SHALL read the Verifier_Mode, the issuer, the client id and the JWKS URI from configuration only, so that the SP2 result changes configuration and not code.

### Requirement 5: Owner match

**User Story:** As an attendee, I want only myself to be able to download, change or void my passes, so that nobody else can cancel my boarding pass.

#### Acceptance Criteria

1. WHEN getApplePass, updatePass or voidPass is called, THE Api_Lambda SHALL compare the caller's SubHash with the SubHash stored in the Pass_Record in constant time.
2. IF the Pass_Record does not exist, is past its Expires_At, or belongs to a different SubHash, THEN THE Api_Lambda SHALL return the same 404 Problem_Response with code `not_found` in all three cases and SHALL NOT change any stored item.
3. IF the `serialNumber` path value is not a UUID v4, THEN THE Api_Lambda SHALL return the same 404 Problem_Response as in criterion 2.

### Requirement 6: Rate limits

**User Story:** As the owner, I want per-attendee limits stored in DynamoDB, so that one Builder ID holder cannot run up cost or flood the service.

#### Acceptance Criteria

1. THE Api_Lambda SHALL count pass writes per SubHash in fixed one-hour windows, counting one unit for each pass in an issuePasses request and one unit for each updatePass or voidPass call.
2. IF an issuePasses request would raise the caller's pass-write count in the current window above 60, THEN THE Api_Lambda SHALL refuse the whole request with a 429 Problem_Response with code `rate_limited` and a `Retry-After` header giving the whole seconds until the window ends, and SHALL NOT create any pass.
3. IF a createHandoff request would raise the caller's hand-off count in the current one-hour window above 10, THEN THE Api_Lambda SHALL return a 429 Problem_Response with code `rate_limited` and a `Retry-After` header giving the whole seconds until the window ends, and SHALL NOT create a hand-off.
4. IF an issuePasses request would raise the caller's number of active passes (not voided and not past Expires_At) above 80, THEN THE Api_Lambda SHALL refuse the whole request with a 429 Problem_Response with code `active_pass_limit`, without a `Retry-After` header, and SHALL NOT create any pass.
5. THE Api_Lambda SHALL NOT refuse an updatePass or voidPass call because of a rate limit, because the contract lists no 429 for those operations and a cancelled session must always be voidable.
6. WHEN the Api_Lambda counts units, THE Api_Lambda SHALL increment the Rate_Counter with a single conditional DynamoDB update, so that concurrent requests cannot together exceed a limit.
7. THE Api_Lambda SHALL give each Rate_Counter an Expires_At at the end of its window and a TTL attribute 120 seconds after that.

### Requirement 7: Request validation

**User Story:** As the owner, I want every request body checked strictly against the shared rules, so that no crafted text, link or date reaches a pass.

#### Acceptance Criteria

1. WHEN issuePasses or updatePass receives PassFields, THE Api_Lambda SHALL validate each PassFields with the schema returned by `createPassFieldsSchema` for the configured Event_Window.
2. IF any PassFields fails validation (including a URL or domain, a bidirectional override or other disallowed character, a control character, a date outside the Event_Window, an `endsAt` not after `startsAt`, a session longer than 10 hours, or a field longer than its limit), THEN THE Api_Lambda SHALL return a 400 Problem_Response with code `invalid_request` and SHALL NOT create or change any item.
3. IF a request body contains a property that the contract schema does not define, at any level, THEN THE Api_Lambda SHALL return a 400 Problem_Response with code `invalid_request` rather than ignore the property.
4. IF an issuePasses request contains two PassFields with the same `sessionCode`, THEN THE Api_Lambda SHALL return a 400 Problem_Response with code `invalid_request`.
5. IF an updatePass request carries a `sessionCode` different from the one in the Pass_Record, THEN THE Api_Lambda SHALL return a 400 Problem_Response with code `invalid_request`.
6. IF a request body is not valid JSON, exceeds 64 KiB, or has a list length outside the contract bounds (1 to 2 platforms, 1 to 25 passes, 1 to 80 serial numbers), THEN THE Api_Lambda SHALL return a 400 Problem_Response with code `invalid_request`.
7. THE Api_Lambda SHALL NOT trim, truncate, normalise or otherwise reinterpret any PassFields value; a value that fails the rules is refused.

### Requirement 8: Issue passes

**User Story:** As an attendee, I want passes issued for my reserved sessions, so that I can add them to my wallet.

#### Acceptance Criteria

1. WHEN a valid issuePasses request passes the rate limits, THE Api_Lambda SHALL create one Pass_Record per PassFields with a new Serial_Number, the caller's SubHash, the PassFields, the requested platforms, status `active`, version 1, a Last_Updated of the current instant, the SHA-256 of the pass's Auth_Token, and an Expires_At of `endsAt` plus 24 hours.
2. THE Api_Lambda SHALL write each Pass_Record with a condition that no item with the same key exists.
3. WHEN `google` is among the requested platforms and Google Wallet is enabled, THE Api_Lambda SHALL insert a Google Wallet generic object for each new pass.
4. IF a Google Wallet insert fails for a pass, THEN THE Api_Lambda SHALL still keep the Pass_Record, SHALL omit `google` from that pass's `platforms` in the response, and SHALL record a `GoogleWalletFailure` metric.
5. WHEN all Pass_Records are written, THE Api_Lambda SHALL return 201 with `{passes: [{serialNumber, sessionCode, platforms}]}` in the same order as the request.

### Requirement 9: Apple pass content

**User Story:** As an attendee, I want an honest, clearly unofficial boarding pass that updates itself, so that I can trust what my phone shows and never mistake it for a ticket.

#### Acceptance Criteria

1. THE Api_Lambda and the Passkit_Lambda SHALL build every Apple_Pass from one fixed server template with `passkit-generator`, as a `boardingPass` pass with `transitType` `PKTransitTypeGeneric`.
2. THE Apple_Pass SHALL show the text "Unofficial. Your badge is your ticket." on the front and on the back.
3. THE Apple_Pass SHALL carry no `barcodes` and no `barcode` key, `sharingProhibited` set to `true`, the configured `passTypeIdentifier` and `teamIdentifier`, the pass's Serial_Number, and `formatVersion` 1.
4. THE Apple_Pass SHALL carry an `expirationDate` equal to `endsAt`, or equal to the void instant when the pass is voided, together with `voided: true` when voided.
5. THE Apple_Pass SHALL carry one `relevantDates` interval with `startDate` equal to `startsAt` minus 40 minutes (boarding closes minus 30 minutes) and `endDate` equal to `endsAt`.
6. THE Apple_Pass SHALL show boarding closes as `startsAt` minus 10 minutes, and SHALL show every time in the Event_Window timezone with the timezone stated once on the back.
7. WHEN `venue` is empty, THE Apple_Pass SHALL show "Venue not published" as the gate.
8. THE Apple_Pass SHALL carry a Web_Service_URL equal to the configured public base URL joined with the configured PassKit path (default `/api/passkit`), and an `authenticationToken` equal to the pass's Auth_Token.
9. THE pass-service SHALL derive each Auth_Token as HMAC-SHA256 of a fixed domain label and the Serial_Number with the Pepper, so that the token is never stored and every rebuild of the same pass carries the same token, and SHALL store only the SHA-256 of the token.
10. THE Apple_Pass SHALL use only original artwork stored in `packages/pass-service`, including the required icon, and SHALL NOT include any AWS logo, AWS colour scheme or wording that suggests an official AWS product.
11. THE Apple_Pass SHALL include `attendeeName` only when the PassFields carry it, and SHALL NOT include any client-supplied image, URL or barcode.

### Requirement 10: Download a pass

**User Story:** As an attendee, I want to download the latest version of my Apple pass, so that I can save it locally or add it on my computer.

#### Acceptance Criteria

1. WHEN getApplePass passes the owner match, THE Api_Lambda SHALL sign the latest Apple_Pass from the Pass_Record on demand and return it with status 200 and `Content-Type: application/vnd.apple.pkpass`.
2. THE Api_Lambda SHALL NOT store any signed Apple_Pass or Apple_Bundle.

### Requirement 11: Update a pass

**User Story:** As an attendee, I want a changed session time or room reflected on my phone, so that my pass always shows the right gate.

#### Acceptance Criteria

1. WHEN updatePass passes the owner match and validation for an active pass, THE Api_Lambda SHALL replace the stored PassFields, increase the version by exactly 1, advance Last_Updated, and set Expires_At to the new `endsAt` plus 24 hours on the Pass_Record and on its Device_Registrations.
2. WHEN a pass is updated, THE Api_Lambda SHALL send one APNs push to every Device_Registration of that pass and, if the pass has a Google object, patch the Google object with the new content.
3. WHEN the update is stored, THE Api_Lambda SHALL return 200 with `{serialNumber, version}`, whether or not the pushes and the Google patch succeed.
4. IF the pass is voided, THEN THE Api_Lambda SHALL return a 404 Problem_Response with code `not_found` and SHALL NOT change the Pass_Record.
5. WHEN Last_Updated is advanced, THE pass-service SHALL set it to the later of the current instant and one whole second after the previous Last_Updated, truncated to whole seconds, so that a second-precision `If-Modified-Since` always sees the change.

### Requirement 12: Void a pass

**User Story:** As an attendee, I want the pass for a cancelled session voided and moved to my wallet's expired passes, so that I am never misled by a stale pass.

#### Acceptance Criteria

1. WHEN voidPass passes the owner match for an active pass, THE Api_Lambda SHALL set status `voided`, record the void instant, increase the version by exactly 1 and advance Last_Updated.
2. WHEN a pass becomes voided, THE Api_Lambda SHALL send one APNs push to every Device_Registration of that pass and, if the pass has a Google object, patch its `state` to `INACTIVE`.
3. WHEN voidPass is called for a pass that is already voided, THE Api_Lambda SHALL return 200 with `{serialNumber, status: "voided"}`, SHALL NOT change the version or Last_Updated, SHALL NOT send any APNs push, and SHALL retry the Google `INACTIVE` patch only if an earlier patch did not succeed.
4. WHEN the void is stored, THE Api_Lambda SHALL return 200 with `{serialNumber, status: "voided"}`, whether or not the pushes and the Google patch succeed.

### Requirement 13: APNs pushes

**User Story:** As an attendee, I want my phone told when a pass changes, so that Wallet fetches the new version without me doing anything.

#### Acceptance Criteria

1. WHEN the APNs_Client pushes for a Device_Registration, THE APNs_Client SHALL send an HTTP/2 `POST` to `/3/device/<pushToken>` on the configured APNs host (default `api.push.apple.com`, port 443) over TLS authenticated with the Pass Type ID certificate and key from the `compass/<env>/apple-pass` secret, with an `apns-topic` header equal to the configured `passTypeIdentifier` and the body `{}`.
2. WHERE an APNs push type is configured, THE APNs_Client SHALL send it as the `apns-push-type` header, and otherwise SHALL omit that header.
3. IF APNs answers 410, or answers 400 with reason `BadDeviceToken`, THEN THE APNs_Client SHALL delete that Device_Registration and record an `ApnsInvalidToken` metric.
4. IF APNs answers any other non-200 status, times out, or the connection fails, THEN THE APNs_Client SHALL keep the Device_Registration, record an `ApnsFailure` metric, and SHALL NOT retry within the request.
5. THE APNs_Client SHALL bound each push to a configured timeout (default 2 seconds) and all pushes of one request to a configured total budget (default 4 seconds), sending pushes for one request concurrently on one HTTP/2 connection.
6. WHERE APNs is disabled by configuration, THE Api_Lambda SHALL skip every push and record an `ApnsSkipped` metric, so that the SP3 fallback (expiry plus sync instructions) needs no code change.
7. THE APNs_Client SHALL NOT log any push token, device identifier or certificate material.

### Requirement 14: Google Wallet

**User Story:** As an Android attendee, I want my passes in Google Wallet with the same lifecycle as Apple, so that a cancelled session leaves my active passes.

#### Acceptance Criteria

1. WHEN the Google_Wallet_Client builds a generic object, THE Google_Wallet_Client SHALL set `id` to the Google_Object_Id, `classId` to `<issuerId>.<configured class suffix>`, `state` to `ACTIVE`, `cardTitle`, `header` (the session title), `subheader` (the session code), `textModulesData` holding the gate, boarding closes, start and the disclaimer "Unofficial. Your badge is your ticket.", and `validTimeInterval.end.date` equal to `endsAt`, and SHALL NOT set `barcode`.
2. WHEN the Google_Wallet_Client inserts an object, THE Google_Wallet_Client SHALL call `POST https://walletobjects.googleapis.com/walletobjects/v1/genericObject` with an OAuth access token for the scope `https://www.googleapis.com/auth/wallet_object.issuer` obtained with `google-auth-library` from the service account in the `compass/<env>/google-wallet` secret.
3. IF an insert answers 409, THEN THE Google_Wallet_Client SHALL patch the existing object with the same content instead.
4. WHEN the Google_Wallet_Client patches an object, THE Google_Wallet_Client SHALL call `PATCH https://walletobjects.googleapis.com/walletobjects/v1/genericObject/{resourceId}` with the Google_Object_Id as the resource id.
5. WHEN the Google_Wallet_Client creates a save link, THE Google_Wallet_Client SHALL sign an RS256 JWT with the service account private key whose claims are `iss` (the service account email), `aud` `google`, `typ` `savetowallet`, `iat`, `origins` (an empty list) and `payload.genericObjects` listing `{id, classId}` for each chosen pass, and SHALL return `https://pay.google.com/gp/v/save/<jwt>`.
6. IF a save JWT is longer than 1800 characters, THEN THE Google_Wallet_Client SHALL still return the link and record a `GoogleSaveJwtOversize` metric.
7. WHERE Google Wallet is disabled by configuration, THE Api_Lambda SHALL accept `google` in requests but SHALL make no Google call, omit `google` from issued platforms, and return `google: null` in hand-off views.
8. THE Google_Wallet_Client SHALL NOT log any object content, issuer id, service account email, key or JWT.

### Requirement 15: Create a hand-off

**User Story:** As an attendee, I want a QR code that opens my chosen passes on my phone for a short time, so that I can move passes from my computer without email or cables.

#### Acceptance Criteria

1. WHEN createHandoff passes validation and the rate limit, THE Api_Lambda SHALL generate a Handoff_Id from 16 random bytes, store only its SHA-256 in a Handoff_Record with the caller's SubHash, the chosen serial numbers, the include flags and an Expires_At of the current instant plus 15 minutes, and return 201 with `{handoffId, boardUrl, expiresAt}`.
2. THE Api_Lambda SHALL set `boardUrl` to the configured public base URL followed by `/board#h=` and the Handoff_Id.
3. IF any serial number in a createHandoff request is unknown, past its Expires_At, voided, or owned by a different SubHash, THEN THE Api_Lambda SHALL return the same 400 Problem_Response with code `invalid_request` without saying which serial number failed.
4. IF a createHandoff request has `apple`, `google` and `calendar` all false, THEN THE Api_Lambda SHALL return a 400 Problem_Response with code `invalid_request`.

### Requirement 16: Read a hand-off

**User Story:** As an attendee holding my phone, I want the board page to show my passes and give me Add to Apple Wallet, Save to Google Wallet and calendar options, so that boarding is one tap.

#### Acceptance Criteria

1. WHEN getHandoff receives a Handoff_Id whose SHA-256 matches a Handoff_Record that is before its Expires_At, THE Api_Lambda SHALL return 200 with the `HandoffView`: `expiresAt`, the sessions of the hand-off passes that are still active, `apple.bundlePaths`, `google` and `calendarPath`.
2. THE Api_Lambda SHALL split the active Apple passes of a hand-off into consecutive bundles of at most 10 passes in the stored order, and SHALL list one path `/api/v1/handoffs/<handoffId>/apple/<index>` per bundle, or an empty list when `apple` was not included.
3. WHEN getHandoffAppleBundle receives a valid Handoff_Id and a bundle index inside the bundle list, THE Api_Lambda SHALL sign that Apple_Bundle on demand and return it with status 200 and `Content-Type: application/vnd.apple.pkpasses`.
4. WHERE `google` was included and Google Wallet is enabled and at least one active hand-off pass has a Google object, THE Api_Lambda SHALL return `google: {saveUrl}` built per Requirement 14.5, and otherwise `google: null`.
5. WHERE `calendar` was included and the hand-off calendar is enabled by configuration, THE Api_Lambda SHALL return `calendarPath` `/api/v1/handoffs/<handoffId>/calendar.ics`, and getHandoffCalendar SHALL return a `text/calendar` file with one VEVENT per active hand-off pass, built from the pass fields, with times in UTC and a display alarm at boarding closes.
6. WHERE the hand-off calendar is disabled by configuration (cut-list item 5), THE Api_Lambda SHALL return `calendarPath: null`, and getHandoffCalendar SHALL return a 404 Problem_Response with code `not_enabled`.
7. IF a Handoff_Id is malformed (not 22 base64url characters), unknown, or at or past its Expires_At, or a bundle index is outside the bundle list, THEN THE Api_Lambda SHALL return the same 404 Problem_Response with code `not_found` for getHandoff, getHandoffAppleBundle and getHandoffCalendar.

### Requirement 17: PassKit registration

**User Story:** As an attendee's iPhone, I want to register and unregister for updates exactly as Apple specifies, so that Wallet keeps the pass current.

#### Acceptance Criteria

1. WHEN registerDevice or unregisterDevice receives a request, THE Passkit_Lambda SHALL accept it only when the `Authorization` header is `ApplePass <token>`, the `passTypeIdentifier` path value equals the configured one, the Pass_Record exists and is before its Expires_At, and the SHA-256 of the token equals the stored hash in a constant-time comparison.
2. IF any condition of criterion 1 fails, THEN THE Passkit_Lambda SHALL return a 401 Problem_Response with code `unauthorized`, the same body in every case, and SHALL NOT change any item.
3. WHEN registerDevice is accepted and no Device_Registration exists for that DeviceHash and Serial_Number, THE Passkit_Lambda SHALL store a Device_Registration with the DeviceHash, the Serial_Number, the push token and the pass's Expires_At, and return 201.
4. WHEN registerDevice is accepted and a Device_Registration already exists for that DeviceHash and Serial_Number, THE Passkit_Lambda SHALL replace its push token with the one in the request and return 200.
5. IF the push token in a registerDevice body is not 1 to 256 hexadecimal characters, THEN THE Passkit_Lambda SHALL return the 401 Problem_Response of criterion 2 and SHALL NOT store it.
6. WHEN unregisterDevice is accepted, THE Passkit_Lambda SHALL delete the Device_Registration for that DeviceHash and Serial_Number if it exists, and return 200 in both cases.
7. THE Passkit_Lambda SHALL store the DeviceHash and SHALL NOT store the raw `deviceLibraryIdentifier`.

### Requirement 18: PassKit updates and log

**User Story:** As an attendee's iPhone, I want to learn which passes changed and fetch the latest version, so that a void or a room change reaches me.

#### Acceptance Criteria

1. WHEN getSerialNumbers receives a request for a DeviceHash with Device_Registrations for the configured `passTypeIdentifier`, THE Passkit_Lambda SHALL return 200 with `serialNumbers` listing every registered pass that is before its Expires_At and whose Last_Updated is later than `passesUpdatedSince`, and `lastUpdated` set to the latest Last_Updated among those passes, as decimal epoch milliseconds.
2. IF no registered pass matches, the device is unknown, or the `passTypeIdentifier` differs from the configured one, THEN THE Passkit_Lambda SHALL return 204 with no body.
3. IF `passesUpdatedSince` is absent or is not a decimal integer, THEN THE Passkit_Lambda SHALL treat it as absent and consider every registered pass, as Apple's guidance asks for a request with no tag.
4. WHEN getLatestPass is authorised per Requirement 17.1 and the request carries no `If-Modified-Since`, an unparseable one, or one earlier than the pass's Last_Updated at second precision, THE Passkit_Lambda SHALL return 200 with the latest signed Apple_Pass, `Content-Type: application/vnd.apple.pkpass` and a `Last-Modified` header equal to Last_Updated as an HTTP date.
5. WHEN getLatestPass is authorised and `If-Modified-Since` is at or after the pass's Last_Updated at second precision, THE Passkit_Lambda SHALL return 304 with no body.
6. IF getLatestPass is not authorised per Requirement 17.1, THEN THE Passkit_Lambda SHALL return the 401 Problem_Response of Requirement 17.2.
7. WHEN logMessages receives a body, THE Passkit_Lambda SHALL record the number of messages as a `PasskitLogMessages` metric, SHALL NOT store or log any message text, and SHALL return 200.

### Requirement 19: Storage, expiry and retention

**User Story:** As the owner, I want every stored item minimal, keyed by opaque values and treated as gone once it expires, so that the service meets the POPIA record in build plan 4.2.

#### Acceptance Criteria

1. THE pass-service SHALL store Pass_Records, Device_Registrations, Handoff_Records and Rate_Counters in the one DynamoDB table named by configuration, using the key schema in the design, with GSI1 mapping a pass to its devices and GSI2 mapping a SubHash to its passes, hand-offs and counters.
2. WHEN any operation reads an item, THE pass-service SHALL treat the item as absent if the current instant is at or after its Expires_At, whether or not DynamoDB TTL has deleted it.
3. THE pass-service SHALL set the TTL attribute `ttl` of every item, in epoch seconds, to its Expires_At or later: a Pass_Record and its Device_Registrations at `endsAt` plus 24 hours, a Handoff_Record at its creation plus 15 minutes, a Rate_Counter at its window end plus 120 seconds.
4. THE pass-service SHALL store no raw Builder ID `sub`, email, ID_Token, `deviceLibraryIdentifier`, Handoff_Id or Auth_Token; it SHALL store SubHash, DeviceHash, the SHA-256 of the Handoff_Id and the SHA-256 of the Auth_Token instead.
5. THE pass-service SHALL store the raw APNs push token only in the Device_Registration, because it is needed to push.

### Requirement 20: Forget me

**User Story:** As an attendee, I want one call that voids my passes and deletes everything the service holds about me, so that I can exercise my POPIA rights.

#### Acceptance Criteria

1. WHEN forgetMe is called with a verified ID_Token, THE Api_Lambda SHALL void every active pass of the caller's SubHash per Requirement 12, including APNs pushes and Google `INACTIVE` patches.
2. WHEN the voids are done, THE Api_Lambda SHALL delete every Pass_Record, Device_Registration, Handoff_Record and Rate_Counter of the caller's SubHash.
3. WHEN the deletions are done, THE Api_Lambda SHALL return 202 with `{voided, deleted}`, where `voided` is the number of passes voided by this call and `deleted` is the number of items deleted.
4. THE Api_Lambda SHALL NOT read, change or delete any item of a different SubHash during forgetMe.
5. WHEN forgetMe is called for a SubHash with no items, THE Api_Lambda SHALL return 202 with `{voided: 0, deleted: 0}`.

### Requirement 21: Secrets

**User Story:** As the owner, I want every certificate, key and pepper read from Secrets Manager at runtime and never anywhere else, so that a public repository and its logs can never leak them.

#### Acceptance Criteria

1. THE Secrets_Provider SHALL read the `compass/<env>/apple-pass`, `compass/<env>/google-wallet` and `compass/<env>/app` secrets, named by configuration, through the Lambda execution role with the AWS SDK for JavaScript v3 Secrets Manager client.
2. THE Secrets_Provider SHALL cache each secret value in memory for a configured time (default 300 seconds) and SHALL call Secrets Manager at most once per secret per cache period, including when requests arrive concurrently.
3. IF a secret cannot be read or does not hold the documented JSON keys, THEN THE Lambda SHALL return a 500 Problem_Response with code `internal_error`, record the outcome `dependency_error`, and SHALL NOT include any secret value or key material in any log, error or response.
4. THE pass-service SHALL NOT contain any certificate, private key, password, pepper, issuer id, Team ID or secret value in source code, tests, fixtures, logs or committed files.
5. THE pass-service tests SHALL NOT read any real secret; they SHALL use Throwaway_PKI and fake secret values generated at test time.
6. THE Passkit_Lambda SHALL read only the `apple-pass` and `app` secrets.

### Requirement 22: Logging and metrics

**User Story:** As the owner, I want logs that help operate the service without holding any identifier, so that the logs are never personal data.

#### Acceptance Criteria

1. WHEN a Lambda finishes a request, THE Request_Logger SHALL write exactly one JSON line holding only the request id, the method and Route_Template, the status, the latency in milliseconds, an outcome from a fixed list, and numeric metric values in CloudWatch embedded metric format.
2. THE Request_Logger SHALL NOT write any path value, query value, header, body, token, `sub`, SubHash, DeviceHash, email, Serial_Number, Handoff_Id, push token, session code, title, issuer id or error message.
3. IF a handler throws, THEN THE Lambda SHALL catch the error at the entry point, return a 500 Problem_Response with code `internal_error`, and log only the outcome `internal_error`, so that the Lambda runtime never logs the error itself.
4. THE pass-service SHALL emit the metrics `ApnsFailure`, `ApnsInvalidToken`, `ApnsSkipped`, `GoogleWalletFailure`, `GoogleSaveJwtOversize` and `PasskitLogMessages`, each a count without identifying dimensions, so that S6 can alarm on APNs failures.
5. THE pass-service SHALL suppress any console output from `passkit-generator`, the AWS SDK and `google-auth-library` during request handling, so that third-party messages cannot carry request content into the logs.

### Requirement 23: Health

**User Story:** As the owner running a release, I want a health route, so that the release script can confirm the API is up through CloudFront.

#### Acceptance Criteria

1. WHEN getHealth passes the Origin_Guard, THE Api_Lambda SHALL return 200 with `{status: "ok", version}`, where `version` is the configured service version.
2. THE Api_Lambda SHALL answer getHealth without reading any secret other than the origin-verify value and without reading DynamoDB.

### Requirement 24: Configuration and spike seams

**User Story:** As the owner, I want every spike assumption held in configuration, so that the SP2, SP3 and SP4 results change settings and not code.

#### Acceptance Criteria

1. WHEN a Lambda starts, THE pass-service SHALL parse every environment variable documented in the README and SHALL fail closed with an error that names the variable, without echoing its value, when a required variable is missing or invalid.
2. THE pass-service SHALL hold the Verifier_Mode, the ID token issuer, the client id and the JWKS URI as configuration (SP2).
3. THE pass-service SHALL hold the public base URL, the PassKit path joined into the Web_Service_URL, whether APNs is enabled, the APNs host and the optional APNs push type as configuration (SP3).
4. THE pass-service SHALL hold whether Google Wallet is enabled and the Google class suffix as configuration (SP4).
5. THE pass-service SHALL hold the Event_Window, whether the hand-off calendar is enabled, the secret ids, the table name, the secrets cache time and the service version as configuration.
6. THE design document SHALL contain an owner-run checklist for SP2, SP3 and SP4 with the exact steps and what confirms each assumption, and the task list SHALL contain one task per spike that adjusts configuration once its result arrives.
7. THE pass-service SHALL provide an owner-run local harness that serves both Lambdas on the owner's LAN with an in-memory table and certificate files the owner names by path, for SP3 and SP4, and the harness SHALL NOT print or write any secret or identifier.

### Requirement 25: Testing and coverage

**User Story:** As the owner, I want the service proven by fast, deterministic tests with no real secret or live call, so that the security review can trust the results.

#### Acceptance Criteria

1. THE pass-service test suite SHALL achieve 100% coverage of lines, branches, functions and statements for `packages/pass-service/src/**`, with `packages/pass-service/src/lambda-entry/*.ts` as the only named exclusion.
2. THE pass-service test suite SHALL implement every correctness property in the design as a `fast-check` property test with at least 100 runs.
3. THE pass-service test suite SHALL include named tests for each JWT negative case: wrong `aud`, wrong `iss`, `alg` `none`, expired, unknown `kid`.
4. THE pass-service test suite SHALL include named tests for the PassKit responses 200, 201, 204, 304 and 401.
5. THE pass-service test suite SHALL include named tests for hand-off expiry, for 429 on issuePasses and createHandoff, and for PassFields rejection of URLs, bidirectional overrides, control characters, out-of-window dates and oversized fields.
6. THE pass-service test suite SHALL include a log-redaction test that drives every operation with known identifier values and asserts that none of them appears in any captured log line, console output or response.
7. THE pass-service test suite SHALL include a contract test for every one of the 15 operations that checks method, Route_Template, status codes and response bodies against `contracts/compass-api.openapi.yaml`.
8. THE pass-service test suite SHALL NOT call Secrets Manager, DynamoDB, APNs, Google, the JWKS endpoint or any other network service; every such dependency SHALL be injected and faked, apart from local loopback servers that the tests start themselves.

### Requirement 26: Documentation and hand-off

**User Story:** As the integrator and the S6 engineer, I want the service's interface written down in one place, so that infrastructure, review and the article can proceed without reading the code.

#### Acceptance Criteria

1. THE pass-service SHALL include a `packages/pass-service/README.md` that covers Requirement 1.7, the secret JSON layout per secret, how the owner converts the Apple `.p12` into the PEM values the secret holds, the SP2, SP3 and SP4 settings, and the ADR-026 re-check result.
2. WHEN the spec is complete, THE pass-service stream SHALL save two or three screenshots or terminal captures of the feature working to `docs/article/screenshots/pass-service/`, containing no identifier, token or secret.
3. IF S5 needs a change to a file it does not own (a dependency, a contract or another stream's file), THEN THE pass-service stream SHALL record it as a request for the integrator in the Notes section of `tasks.md` and SHALL NOT make the change.

### Requirement 27: Security review amendments

**User Story:** As the owner, I want the security review findings built in, so that a crafted request, a hostile device or a deletion call cannot be turned against the service.

#### Acceptance Criteria

1. THE pass-service SHALL pass every date to `passkit-generator` as a Date built with `new Date(Date.parse(x))` or its canonical `toISOString()` form, never as a client string (H1).
2. WHEN forgetMe runs, THE Api_Lambda SHALL NOT delete any Rate_Counter, SHALL count the call in a `forgetMe` counter limited to 5 per one-hour window, and over the limit SHALL still erase the data but skip pushes and Google patches (H2).
3. THE pass-service SHALL store at most 10 live Device_Registrations per pass (a registration past the cap answers 200 and is not stored), SHALL limit updates to 20 per hour per pass and 120 per hour per SubHash by skipping APNs and Google fan-out over the limit while still storing the update, and SHALL always fan out a void (H3).
4. THE pass-service SHALL derive SubHash, DeviceHash and the Auth_Token key with HKDF-SHA256 from the Pepper with the info strings `compass/sub/v1`, `compass/device/v1` and `compass/authtoken/v1`, SHALL derive the Auth_Token as HMAC of the serial and a per-pass random 16-byte `tokenSalt`, and SHALL store `pepperId` on the app secret and on every record (M1).
5. THE Origin_Guard SHALL accept an optional `originVerifyPrevious` and compare SHA-256 digests with `timingSafeEqual` (M2).
6. WHEN forgetMe runs, THE Api_Lambda SHALL delete first and then fan out best effort within the time budget, and SHALL return 202 even when the fan-out is partial (M3).
7. THE pass-service SHALL set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on every response except getHealth, SHALL set no CORS header, and SHALL cap reads of one hand-off at 30 (M4).
8. THE Token_Verifier SHALL use a grace of 0 seconds, SHALL require a string `aud` in `oidc` mode, and the configuration SHALL require the JWKS URI host to equal the issuer host (L2, L3).
9. THE APNs_Client SHALL attach an `error` listener to every session and stream (L5).

### Requirement 28: Code review amendments

**User Story:** As the owner, I want the code review findings fixed and written down, so that the service behaves as the amended spec says.

#### Acceptance Criteria

1. forget_me and the table adapter SHALL send each key at most once in a BatchWriteItem request, because DynamoDB rejects a batch that names a key twice (C: a registration comes back from both GSI2 and GSI1); the in-memory table rejects such a batch (H1).
2. WHEN issuePasses creates passes, THE Api_Lambda SHALL create every Pass_Record first, delete the records already created if a later write fails (so a retry is safe), and then run the Google inserts at most five at a time under the overall budget GOOGLE_INSERT_BUDGET_MS (default 8000); a pass whose insert did not finish in time is returned as Apple only and counted as a GoogleWalletFailure, and a late insert still marks its pass active (H2).
3. THE Passkit_Lambda SHALL list updatable passes by a millisecond update tag that is strictly increasing per pass and compared with at or after the passesUpdatedSince tag, so an update made in the same second as a previous list is never lost, and SHALL keep second precision for Last-Modified and If-Modified-Since; the pass at the tag itself may be listed again and its fetch answers 304 (M1).
4. THE pass-service SHALL keep the 80 active pass cap and the 10 registrations per pass cap exact when requests run at the same time: each live pass has an ACTIVE marker and each registration a PASSREG copy in the base table, counted with strongly consistent queries; a request counts again after it has written, and takes its own writes back if it left the cap exceeded; a device library identifier is 16 to 128 characters (M2, N7).
