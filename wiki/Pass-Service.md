# Pass service

_For architects: how the Compass pass service is built, what its routes and limits are, how passes are signed and updated, and what it stores._

The pass service is the [Compass API](Glossary#compass-api). It issues, updates and [voids](Glossary#void) unofficial [Boarding Passes](Glossary#boarding-pass) for Apple Wallet and Google Wallet, serves the 15 minute [hand-off](Glossary#hand-off) to the phone, runs Apple's [PassKit](Glossary#passkit) web service and erases everything on request. It runs as two [Lambda](Glossary#lambda) functions behind [CloudFront](Glossary#cloudfront), [WAF](Glossary#waf) and [API Gateway](Glossary#api-gateway), with one [DynamoDB](Glossary#dynamodb) table. Only attendees signed in with [AWS Builder ID](Glossary#aws-builder-id) can use it.

## What is inside

The code is in [packages/pass-service/src](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src).

| Folder                                                                                                                                                                                                                                                                                                                                        | Role                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [app](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/app)                                                                                                                                                                                                                                      | The two route tables and the shared request pipeline.                                      |
| [handlers](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/handlers)                                                                                                                                                                                                                            | One handler per operation, `api` and `passkit`.                                            |
| [services](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/services)                                                                                                                                                                                                                            | The pass lifecycle (issue, update, void), the hand-off service and the Google insert step. |
| [data](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/data)                                                                                                                                                                                                                                    | Key formats, record types, repositories and the rate limiter.                              |
| [auth](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/auth) and [security](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/security)                                                                                                             | ID token verification, keyed hashing, the Apple authentication token and the origin check. |
| [apple](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/apple), [artwork](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/artwork) and [apns](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/apns) | Apple pass layout, signing and update pushes.                                              |
| [google](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/google)                                                                                                                                                                                                                                | Google Wallet generic objects, the REST client and the save link.                          |
| [calendar](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/calendar)                                                                                                                                                                                                                            | The hand-off calendar file.                                                                |
| [config](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/config) and [credentials](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/credentials)                                                                                                   | Strict environment parsing and cached Secrets Manager reads.                               |
| [observability](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/observability)                                                                                                                                                                                                                  | One allowlisted log line per request, embedded metrics and a console guard.                |
| [lambda-entry](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/lambda-entry) and [bundling](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/bundling)                                                                                             | The two Lambda handlers and the deterministic zip build (`npm run build:lambda`).          |
| [harness](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/harness)                                                                                                                                                                                                                              | A local server with an in-memory table, for owner-run tests.                               |

## Two Lambdas

| Function  | Timeout | Serves                                                         | Can write                                                            |
| --------- | ------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `api`     | 15 s    | The 11 attendee and hand-off routes under `/api/v1`            | `PASS#`, `DEV#`, `HANDOFF#`, `RATE#`, `ACTIVE#` and `PASSREG#` items |
| `passkit` | 5 s     | The 5 Apple PassKit web service routes under `/api/passkit/v1` | `DEV#` and `PASSREG#` items only                                     |

Both are `nodejs24.x` on `arm64` with 512 MB. The `passkit` function cannot read the Google key. See [AWS architecture](AWS-Architecture#lambda) for the roles.

## Routes

The routes come from the [OpenAPI](Glossary#openapi) contract in [contracts/compass-api.openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/contracts/compass-api.openapi.yaml). Both route tables are typed against the generated contract, so a missing or extra route fails the build. Full details are on [Pass API](Pass-API). Every route also needs the API key, which CloudFront adds; the table shows the caller's own credential.

| Operation                        | Route                                                                                                                | Auth                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| getHealth                        | `GET /api/v1/health`                                                                                                 | none                                  |
| issuePasses                      | `POST /api/v1/passes`                                                                                                | ID token                              |
| getApplePass                     | `GET /api/v1/passes/{serialNumber}/apple`                                                                            | ID token                              |
| updatePass                       | `PUT /api/v1/passes/{serialNumber}`                                                                                  | ID token                              |
| voidPass                         | `POST /api/v1/passes/{serialNumber}/void`                                                                            | ID token                              |
| createHandoff                    | `POST /api/v1/handoffs`                                                                                              | ID token                              |
| getHandoff                       | `GET /api/v1/handoffs/{handoffId}`                                                                                   | hand-off id                           |
| getHandoffAppleBundle            | `GET /api/v1/handoffs/{handoffId}/apple/{bundleIndex}`                                                               | hand-off id                           |
| getHandoffApplePass              | `GET /api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}`                                                         | hand-off id                           |
| getHandoffCalendar               | `GET /api/v1/handoffs/{handoffId}/calendar.ics`                                                                      | hand-off id                           |
| forgetMe                         | `DELETE /api/v1/me`                                                                                                  | ID token                              |
| registerDevice, unregisterDevice | `POST`, `DELETE /api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}` | Apple token                           |
| getSerialNumbers                 | `GET /api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}`                           | none (Apple sends no credential here) |
| getLatestPass                    | `GET /api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}`                                                     | Apple token                           |
| logMessages                      | `POST /api/passkit/v1/log`                                                                                           | none                                  |

## Key behaviours

- **The request pipeline.** Every request first passes the origin check: the `x-origin-verify` header that CloudFront adds is compared in constant time with the current value, or the previous one during a rotation. Then the route lookup, then the handler. Every error becomes an `application/problem+json` response, and exactly one log line is written. See [pipeline.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/app/pipeline.ts).
- **ID token verification.** [token-verifier.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/auth/token-verifier.ts) uses `aws-jwt-verify`, refuses any algorithm but RS256 before a key lookup, allows no clock grace and rebuilds its key cache every hour. Every token failure is the same 401. The email claim is never read. The `sub` claim becomes a keyed hash (HMAC-SHA256 with a key derived by HKDF from a secret pepper), and that hash is the only identity stored.
- **Issue.** Up to 25 passes per request. The service checks the 80 active passes cap, consumes the hourly pass-write limit, gives each pass a random UUID serial, derives its Apple authentication token, stores the record with an expiry of session end plus 24 hours, checks the cap again with a strongly consistent count, and inserts Google objects within a time budget. A failure part way deletes what it created, so the client can retry.
- **Apple signing.** [pass-signer.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/apple/pass-signer.ts) signs `.pkpass` files and `.pkpasses` bundles of up to 10 passes in memory with `passkit-generator` 3.7.0, using the Pass Type ID certificate from Secrets Manager. Nothing is written to disk. Dates reach the library as `Date` objects, never as client strings. A pass expires at the session end; a voided pass carries `voided` and expires at the void time.
- **Update and void.** A version check guards every save, with one retry after a conflict. Updates and voids are never refused for rate reasons; over the update limits the change is stored but the fan-out is skipped. A void always fans out.
- **APNs.** [apns-client.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/apns/apns-client.ts) opens one HTTP/2 session per call to `api.push.apple.com`, authenticated with the Pass Type ID certificate, sends an empty push to every registered device, and deletes registrations whose token Apple reports as invalid. Nothing is retried; failures are counted as the `ApnsFailure` metric. Default timeouts are 2 s per push and 4 s per call.
- **Google Wallet.** [google-wallet-client.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/google/google-wallet-client.ts) inserts and patches generic objects at `walletobjects.googleapis.com`. A void patches the object to `INACTIVE`. An update with a venue, room or time change adds one notifying message. The save link is an RS256 JWT signed with the service account key that names objects already inserted. One link for all passes is offered only when it stays within 1,800 characters.
- **Hand-off.** `createHandoff` stores only the SHA-256 of a random id, for 15 minutes, and returns `https://<host>/board#h=<id>`. Every unusable hand-off (malformed, unknown, expired, read too often) is the same 404. The view lists each session with its venue, Apple bundle paths, Google save links and the calendar path. With 8 sessions or fewer it offers top actions for all passes; with more, buttons per session.
- **PassKit web service.** Devices register with the pass's authentication token. At most 10 live registrations are kept per pass. The latest pass answers 304 when nothing changed since `If-Modified-Since`. Log messages are counted, never stored.
- **forget_me.** `DELETE /api/v1/me` reads every item of the caller through the subject index, deletes them, then pushes the voids and patches Google objects to `INACTIVE` from the in-memory copies, within a time budget. Rate counters are kept so erasing cannot reset a limit. See [Data and privacy](Data-and-Privacy#forget_me-fan-out).

## Rate limits

Fixed one-hour windows aligned to the epoch hour, counted with one conditional DynamoDB update each, so concurrent requests cannot together pass a limit. From [rate-limiter.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/data/rate-limiter.ts):

| Limit                                                                                  | Per               | Value              |
| -------------------------------------------------------------------------------------- | ----------------- | ------------------ |
| Pass writes (issue counts one per pass; update and void are counted but never refused) | attendee, hour    | 60                 |
| Hand-offs created                                                                      | attendee, hour    | 10                 |
| forget_me calls (over it, data is still erased but the fan-out is skipped)             | attendee, hour    | 5                  |
| Updates that fan out                                                                   | attendee, hour    | 120                |
| Updates that fan out                                                                   | pass, hour        | 20                 |
| Reads of one hand-off                                                                  | hand-off lifetime | 30 plus 2 per pass |
| Active passes                                                                          | attendee          | 80                 |

Edge limits (WAF per IP, API Gateway throttles) are on [AWS architecture](AWS-Architecture).

## Configuration

[config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/config/config.ts) parses the environment strictly and fails closed: a missing or invalid variable stops the function with an error that names the variable and never holds a value.

| Variable                                                                                             | Lambda | Meaning                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `TABLE_NAME`                                                                                         | both   | The DynamoDB table.                                                                                              |
| `APP_SECRET_ID`, `ORIGIN_VERIFY_SECRET_ID`, `APPLE_SECRET_ID`                                        | both   | Secrets Manager names: pepper, origin-verify value, Apple certificate.                                           |
| `GOOGLE_SECRET_ID`, `GOOGLE_WALLET_ENABLED`, `GOOGLE_WALLET_CLASS_SUFFIX`, `GOOGLE_INSERT_BUDGET_MS` | api    | Google Wallet switch, key and class (budget default 8000 ms).                                                    |
| `PUBLIC_BASE_URL`, `PASSKIT_WEB_SERVICE_PATH`                                                        | both   | The public origin and the PassKit path (default `/api/passkit`); together they form each pass's `webServiceURL`. |
| `EVENT_TIMEZONE`                                                                                     | both   | The event's IANA time zone.                                                                                      |
| `EVENT_WINDOW_START`, `EVENT_WINDOW_END`                                                             | api    | The event window passes must fall inside.                                                                        |
| `ID_TOKEN_VERIFIER`, `ID_TOKEN_ISSUER`, `ID_TOKEN_CLIENT_ID`, `ID_TOKEN_JWKS_URI`                    | api    | `cognito` (default) or `oidc` verification settings.                                                             |
| `APNS_ENABLED`, `APNS_HOST`, `APNS_PUSH_TYPE`, `APNS_TIMEOUT_MS`, `APNS_BUDGET_MS`                   | api    | Push switch and limits. The host must be Apple's production or sandbox host exactly.                             |
| `HANDOFF_CALENDAR_ENABLED`                                                                           | api    | Switch for the hand-off calendar file.                                                                           |
| `SECRETS_CACHE_TTL_SECONDS`                                                                          | both   | Secret cache lifetime, default 300.                                                                              |
| `SERVICE_VERSION`                                                                                    | api    | Returned by the health route.                                                                                    |

Terraform sets these from [infra/modules/api/locals.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/api/locals.tf): names and ARNs only, never a secret value.

The reasoning is on [Decisions: Passes and wallets](Decisions-Passes-and-Wallets#update-void-and-expire-every-pass) and [Decisions: Security and privacy](Decisions-Security-and-Privacy#personal-data-on-the-server).

## Build cards

Built in the Build workstream: [project board, Build](https://github.com/users/henniefrancis/projects/3/views/1?filterQuery=workstream%3A%22Build%22). Cards: [board: GP1] (Google layout matches the Apple pass), [board: P05] (Google Wallet publishing access), [board: PK1] (prod Google key and Apple certificate check), [board: L01] (the venue of each session in the hand-off view).

## Related pages

- [Pass API](Pass-API)
- [Flows](Flows)
- [AWS architecture](AWS-Architecture)
- [Data and privacy](Data-and-Privacy)
- [Security](Security)
