# Pass API

_For developers and architects: every operation of the Compass pass API, how each one is authorised, what it returns, the limits it enforces and the headers it sets._

The Pass API is the [Compass API](Glossary#compass-api): a small serverless service that signs unofficial Apple Wallet and Google Wallet [boarding passes](Glossary#boarding-pass), runs Apple's [PassKit](Glossary#passkit) web service for pass updates, and serves the short-lived [hand-off](Glossary#hand-off) to your phone. The MCP server is its main client.

The contract is [contracts/compass-api.openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/contracts/compass-api.openapi.yaml) (OpenAPI 3.0.1, 16 operations). This page summarises it; the contract is the authority. See [Contracts](Contracts) for how it is kept in step with the code.

## Base URL

```text
https://reinvent-compass.vegas
```

Every route is under `/api/`. [CloudFront](Glossary#cloudfront) sends `/api/*` to the [API Gateway](Glossary#api-gateway) stage, uncached and over https only, and everything else to the static site. For example, the health check is `GET https://reinvent-compass.vegas/api/v1/health`. The MCP server has this base URL built in; see [MCP tools](MCP-Tools#environment-variables) for the override used to test dev.

## Authorisation

| Credential       | How it is sent                                                                                                                                                                                           | Who checks it                                                                                                             | Used by                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Bearer ID token  | `Authorization: Bearer <idToken>`: the [AWS Builder ID](Glossary#aws-builder-id) ID token (a JWT) from your sign-in                                                                                      | The `api` [Lambda](Glossary#lambda): signature against the issuer's keys, `iss`, `aud`, `token_use=id`, `exp`, RS256 only | The six attendee routes that act on your passes |
| Hand-off id      | In the path. The board link carries the id in its URL fragment, which the browser never sends with the page request; the board page reads it, clears it from the address bar and then calls these routes | The `api` Lambda, which stores only a SHA-256 of the id: unknown and expired hand-offs both answer 404                    | The four hand-off read routes                   |
| Apple pass token | `Authorization: ApplePass <authenticationToken>`, sent by the phone                                                                                                                                      | The `passkit` Lambda: compared in constant time against the stored SHA-256 of the pass's token                            | Three PassKit routes                            |
| API key          | `x-api-key` header, added by CloudFront                                                                                                                                                                  | API Gateway, on every method                                                                                              | All 16 routes                                   |

The API key and a second origin header, `x-origin-verify`, are added by CloudFront as custom origin headers. A viewer never sends or sees them. A call straight to the API Gateway endpoint is rejected by API Gateway for the missing key, and a call without the right origin header is refused by the Lambda with 403. There is no API Gateway authorizer: the bearer and ApplePass checks happen inside the Lambdas.

## Attendee and hand-off routes

Eleven operations under `/api/v1`, all served by the `api` Lambda.

| Method | Path                                                     | operationId             | Auth                         | Purpose                                                                                                                      | Main responses                                                 |
| ------ | -------------------------------------------------------- | ----------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/api/v1/health`                                         | `getHealth`             | API key only                 | Liveness and version.                                                                                                        | 200 `{ status, version }`                                      |
| POST   | `/api/v1/passes`                                         | `issuePasses`           | Bearer ID token              | Issue Apple and/or Google passes for 1 to 25 reserved sessions.                                                              | 201 serial, session code and platforms per pass; 400; 401; 429 |
| GET    | `/api/v1/passes/{serialNumber}/apple`                    | `getApplePass`          | Bearer ID token, owner match | Download your latest signed Apple pass.                                                                                      | 200 `.pkpass`; 401; 404                                        |
| PUT    | `/api/v1/passes/{serialNumber}`                          | `updatePass`            | Bearer ID token, owner match | Replace the pass content, push to Apple devices and patch the Google object.                                                 | 200 `{ serialNumber, version }`; 400; 401; 404                 |
| POST   | `/api/v1/passes/{serialNumber}/void`                     | `voidPass`              | Bearer ID token, owner match | [Void](Glossary#void) a pass: mark it voided and expired, push to Apple devices, set the Google object INACTIVE. Idempotent. | 200 `{ serialNumber, status: "voided" }`; 401; 404             |
| POST   | `/api/v1/handoffs`                                       | `createHandoff`         | Bearer ID token              | Create a 15-minute hand-off for 1 to 80 pass serials, choosing Apple, Google and calendar.                                   | 201 `{ handoffId, boardUrl, expiresAt }`; 400; 401; 429        |
| GET    | `/api/v1/handoffs/{handoffId}`                           | `getHandoff`            | Hand-off id                  | Read what the hand-off holds: each pass with its own download and save links.                                                | 200; 404                                                       |
| GET    | `/api/v1/handoffs/{handoffId}/apple/{bundleIndex}`       | `getHandoffAppleBundle` | Hand-off id                  | Download a `.pkpasses` bundle of up to 10 passes (Apple's limit).                                                            | 200; 404                                                       |
| GET    | `/api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}` | `getHandoffApplePass`   | Hand-off id                  | Download one signed `.pkpass` from the hand-off.                                                                             | 200; 404                                                       |
| GET    | `/api/v1/handoffs/{handoffId}/calendar.ics`              | `getHandoffCalendar`    | Hand-off id                  | Download a calendar file for the reserved sessions in the hand-off.                                                          | 200 `text/calendar`; 404                                       |
| DELETE | `/api/v1/me`                                             | `forgetMe`              | Bearer ID token              | Void every pass you hold and delete your server records.                                                                     | 202 `{ voided, deleted }`; 401                                 |

The pass content you send (`PassFields`) is the session code, title (1 to 80 characters), [venue](Glossary#venue) and room (up to 40 characters each), start and end inside the event window, an optional walk from the previous session and next [connection](Glossary#connection), and your name only if you opt in. Unknown fields are refused. The server adds the rest, such as when [boarding closes](Glossary#boarding-closes), the disclaimer and the expiry.

## Apple PassKit web service routes

Five operations under `/api/passkit/v1`, all served by the `passkit` Lambda. Their paths follow Apple's specification, because Wallet on the phone calls them.

| Method | Path                                                                                                  | operationId        | Auth                           | Purpose                                                                                    | Main responses                                            |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| POST   | `/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}` | `registerDevice`   | Apple pass token               | Register a device for update pushes for a pass.                                            | 201 registered; 200 already registered; 401               |
| DELETE | `/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}` | `unregisterDevice` | Apple pass token               | Stop update pushes for a pass to a device.                                                 | 200; 401                                                  |
| GET    | `/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}`                | `getSerialNumbers` | None from Apple (API key only) | List the serials registered to the device that changed since `passesUpdatedSince`.         | 200 `{ serialNumbers, lastUpdated }`; 204 nothing changed |
| GET    | `/api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}`                                          | `getLatestPass`    | Apple pass token               | Return the latest signed pass. Honours `If-Modified-Since`.                                | 200 `.pkpass` with `Last-Modified`; 304; 401              |
| POST   | `/api/passkit/v1/log`                                                                                 | `logMessages`      | None from Apple (API key only) | Receive diagnostic log messages from devices. They are counted as a metric and not stored. | 200                                                       |

When a pass changes, the service pushes an empty notification to each registered device through [APNs](Glossary#apns), and Wallet then calls `getSerialNumbers` and `getLatestPass`.

## Errors

Every error is `application/problem+json` with exactly four fields:

```json
{ "type": "about:blank", "title": "Too Many Requests", "status": 429, "code": "rate_limited" }
```

The `code` is one of `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `not_enabled`, `rate_limited`, `active_pass_limit` or `internal_error`. The title comes from a fixed table, so no request input is ever echoed back.

## Limits

The `api` Lambda enforces per-attendee limits in [DynamoDB](Glossary#dynamodb), from [rate-limiter.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/data/rate-limiter.ts). Windows are fixed, one hour long and aligned to the clock hour. Each count is one conditional update, so parallel requests cannot together pass a limit.

| Limit                      | Value                                             | Applies to                                                                                   | Over the limit                                                                          |
| -------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Pass writes                | 60 per hour                                       | `issuePasses` counts one per pass; `updatePass` and `voidPass` are counted but never refused | 429 `rate_limited` with `Retry-After`                                                   |
| Active passes              | 80 at once                                        | `issuePasses`                                                                                | 429 `active_pass_limit`                                                                 |
| Hand-offs                  | 10 per hour                                       | `createHandoff`                                                                              | 429 `rate_limited` with `Retry-After`                                                   |
| Forget me                  | 5 per hour                                        | `forgetMe`                                                                                   | Your data is still deleted, but the pushes to phones and the Google updates are skipped |
| Update pushes per attendee | 120 per hour                                      | `updatePass`                                                                                 | The update is saved, but no push or Google patch is sent                                |
| Update pushes per pass     | 20 per hour                                       | `updatePass`                                                                                 | The update is saved, but no push or Google patch is sent                                |
| Hand-off reads             | 30, plus 2 per pass, for the life of the hand-off | The four hand-off read routes                                                                | 404                                                                                     |

Update and void are never refused, so a pass can always be corrected or voided. Rate counters expire with their window and are never deleted by `forgetMe`, so forgetting cannot reset a limit.

In front of the Lambdas, [WAF](Glossary#waf) limits each IP address to 600 requests to `/api/` and 300 to `/api/passkit/` per five minutes and blocks request bodies over 64 KB, and the API Gateway stage throttles by default at 50 requests per second with a burst of 100, with tighter limits on the routes that write or cost more. See [AWS architecture](AWS-Architecture).

## Response headers

| Header                      | Value                                                                                                                               | Set by                | On                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `Cache-Control`             | `no-store`                                                                                                                          | Lambda                | Every response except `getHealth`                                 |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                           | Lambda and CloudFront | Every response (the Lambda skips `getHealth`; CloudFront adds it) |
| `Referrer-Policy`           | `no-referrer`                                                                                                                       | Lambda and CloudFront | Every response (as above)                                         |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                                                                                      | CloudFront            | Every `/api/*` response                                           |
| `Content-Type`              | `application/json`, `application/problem+json`, `application/vnd.apple.pkpass`, `application/vnd.apple.pkpasses` or `text/calendar` | Lambda                | Every response with a body                                        |
| `Content-Disposition`       | `attachment` with `reinvent-pass.pkpass`, `reinvent-passes-<n>.pkpasses` or `reinvent.ics`                                          | Lambda                | The hand-off downloads                                            |
| `Last-Modified`             | The pass's last update                                                                                                              | Lambda                | `getLatestPass` 200                                               |
| `Retry-After`               | Whole seconds until the window ends                                                                                                 | Lambda                | 429 `rate_limited`                                                |

The service never sends a CORS header: the site and the API share one origin. CloudFront does not cache `/api/*`.

## Related pages

- [Pass service](Pass-Service)
- [Contracts](Contracts)
- [AWS architecture](AWS-Architecture)
- [User guide: Fly](User-Guide-Fly)
- [Security](Security)
