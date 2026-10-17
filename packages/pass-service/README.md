# @compass/pass-service

The Compass API Lambdas of re:Invent Compass (stream S5). Two bundles, `api` and `passkit`, sign
unofficial Apple and Google Wallet boarding passes for signed-in attendees, run Apple's PassKit web
service, push pass updates over APNs, patch Google Wallet objects and serve the 15-minute hand-off to
the phone. The contract is `contracts/compass-api.openapi.yaml` (15 operations); this package never
edits it. Infrastructure is S6's (Terraform only); this README is the interface between the two.

Specs: `.kiro/specs/pass-service/` (requirements, design, tasks).

## Build and test

```
npm ci
npx vitest run --coverage        # 100% lines, branches, functions, statements (lambda-entry excluded)
node packages/pass-service/scripts/run.mjs packages/pass-service/scripts/build.ts
```

The build writes `packages/pass-service/dist/lambda/api.zip` and `passkit.zip` and prints their names,
sizes and SHA-256 values. Each zip holds one file, `index.mjs` (ES module, Node.js 24, minified, no
source map), written deterministically (sorted entries, fixed timestamp, mode 0644): two builds of the
same tree are byte-identical. The build fails at 5 MB; the bundles are about 520 KB.

## Bundles

| Lambda    | Zip                                             | Handler         | Runtime      | Arch    | Memory (plan) | Timeout (plan) | Operations                                                                                                                                 |
| --------- | ----------------------------------------------- | --------------- | ------------ | ------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `api`     | `packages/pass-service/dist/lambda/api.zip`     | `index.handler` | `nodejs24.x` | `arm64` | 512 MB        | 10 s           | getHealth, issuePasses, getApplePass, updatePass, voidPass, createHandoff, getHandoff, getHandoffAppleBundle, getHandoffCalendar, forgetMe |
| `passkit` | `packages/pass-service/dist/lambda/passkit.zip` | `index.handler` | `nodejs24.x` | `arm64` | 512 MB        | 5 s            | registerDevice, unregisterDevice, getSerialNumbers, getLatestPass, logMessages                                                             |

Both run outside a VPC (outbound HTTPS only). The `api` Lambda's forget_me fan-out is cut at twice
`APNS_BUDGET_MS` (8 s by default), close to the 10 s timeout: the data is deleted before the fan-out
starts, so a timeout loses only the response. A 15 s timeout, or `APNS_BUDGET_MS=3000`, leaves room.

## Environment variables

An empty value counts as not set. Parsing is strict and fails closed at start-up with an error that
names the variable (never its value). Checks run in the order of this table.

| Variable                                 | Lambda       | Required            | Default                      | Meaning                                                                                                     |
| ---------------------------------------- | ------------ | ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TABLE_NAME`                             | api, passkit | yes                 |                              | DynamoDB table (`compass-<env>`)                                                                            |
| `APP_SECRET_ID`                          | api, passkit | yes                 |                              | secret `compass/<env>/app`: `pepper`, `pepperId`                                                            |
| `ORIGIN_VERIFY_SECRET_ID`                | api, passkit | yes                 |                              | secret `compass/<env>/origin-verify`: `originVerify`                                                        |
| `APPLE_SECRET_ID`                        | api, passkit | yes                 |                              | secret `compass/<env>/apple-pass`                                                                           |
| `GOOGLE_WALLET_ENABLED`                  | api          | no                  | `true`                       | `true` or `false` (cut-list item 10)                                                                        |
| `GOOGLE_SECRET_ID`                       | api          | when Google enabled |                              | secret `compass/<env>/google-wallet`                                                                        |
| `GOOGLE_WALLET_CLASS_SUFFIX`             | api          | when Google enabled |                              | class id suffix made by `scripts/google-wallet-class.mjs`                                                   |
| `GOOGLE_INSERT_BUDGET_MS`                | api          | no                  | `8000`                       | overall budget for the Google inserts of one issue request (100 to 12000)                                   |
| `PUBLIC_BASE_URL`                        | api, passkit | yes                 |                              | `https://<distribution>.cloudfront.net`, origin only. Set in the second apply; never derived from a request |
| `PASSKIT_WEB_SERVICE_PATH`               | api, passkit | no                  | `/api/passkit`               | joined to the base URL as the pass `webServiceURL`                                                          |
| `EVENT_TIMEZONE`                         | api, passkit | yes                 |                              | IANA zone from GetEvent                                                                                     |
| `EVENT_WINDOW_START`, `EVENT_WINDOW_END` | api          | yes                 |                              | ISO 8601 with offset, from GetEvent                                                                         |
| `ID_TOKEN_VERIFIER`                      | api          | no                  | `cognito`                    | `cognito` or `oidc` (SP2)                                                                                   |
| `ID_TOKEN_ISSUER`                        | api          | yes                 |                              | exact `iss`. In `cognito` mode `https://cognito-idp.<region>.amazonaws.com/<region>_<id>`                   |
| `ID_TOKEN_CLIENT_ID`                     | api          | no                  | `7vmom55m1qstvq8i71ph127bfq` | expected `aud`                                                                                              |
| `ID_TOKEN_JWKS_URI`                      | api          | in `oidc` mode      |                              | `https`, and its host must equal the issuer host                                                            |
| `APNS_ENABLED`                           | api          | no                  | `true`                       | SP3 fallback switch                                                                                         |
| `APNS_HOST`                              | api          | no                  | `api.push.apple.com`         | APNs production host                                                                                        |
| `APNS_PUSH_TYPE`                         | api          | no                  | unset                        | `alert` or `background`, sent only when set (SP3)                                                           |
| `APNS_TIMEOUT_MS`, `APNS_BUDGET_MS`      | api          | no                  | `2000`, `4000`               | per push and per request                                                                                    |
| `HANDOFF_CALENDAR_ENABLED`               | api          | no                  | `true`                       | cut-list item 5 switch                                                                                      |
| `SECRETS_CACHE_TTL_SECONDS`              | api, passkit | no                  | `300`                        | secret cache period                                                                                         |
| `SERVICE_VERSION`                        | api          | yes                 |                              | returned by getHealth                                                                                       |

The Lambdas never read or log the `x-api-key` header (API Gateway enforces it) or any other header
apart from `x-origin-verify`, `Authorization`, `If-Modified-Since` and the content type.

## Secrets (S6 creates the containers, the owner loads the values)

| Secret                        | JSON keys                                                                                                 | Read by      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| `compass/<env>/app`           | `pepper`, `pepperId`                                                                                      | api, passkit |
| `compass/<env>/origin-verify` | `originVerify`; `originVerifyPrevious` only while rotating                                                | api, passkit |
| `compass/<env>/apple-pass`    | `passTypeIdentifier`, `teamIdentifier`, `signerCertPem`, `signerKeyPem`, `signerKeyPassphrase`, `wwdrPem` | api, passkit |
| `compass/<env>/google-wallet` | `issuerId`, `serviceAccount` (the downloaded key JSON; `client_email` and `private_key` are read)         | api          |

Each secret is read at run time through the Lambda role with a per-secret cache and a single in-flight
fetch. The pepper is never rotated during the event. The emergency runbook is "void all and flush":
void every pass, delete the table items, then load a new pepper. Origin-verify rotates alone: put the
new value in `originVerify` and the old one in `originVerifyPrevious`, update CloudFront, then remove
`originVerifyPrevious`.

SubHash, DeviceHash and the Auth_Token key come from the pepper by HKDF-SHA256 with the info strings
`compass/sub/v1`, `compass/device/v1` and `compass/authtoken/v1`. Each pass has a random 16-byte
`tokenSalt`; the Apple `authenticationToken` is HMAC-SHA256 of the serial and the salt, 43 base64url
characters, re-derived on every rebuild and never stored (only its SHA-256 is).

### Converting the Apple `.p12` to the PEM values (owner, once)

`passkit-generator` takes PEM, not `.p12`. Keep the passwords in environment variables (never on a
command line or in a file), write the intermediate files to a private folder outside the repository,
and shred them afterwards. Add `-legacy` to the first two commands for a `.p12` exported from Keychain
Access on a recent OpenSSL.

```
export P12PASS=...  KEYPASS=...      # typed in a private shell, never echoed
openssl pkcs12 -in <your-file>.p12 -clcerts -nokeys -passin env:P12PASS -out signer-cert.pem
openssl pkcs12 -in <your-file>.p12 -nocerts -passin env:P12PASS -passout env:KEYPASS -out signer-key.pem
openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
```

`scripts/load-secrets.sh` (S6) loads the three files into the secret by file or standard input; the
secret is never read back. Then `shred -u signer-key.pem signer-cert.pem wwdr.pem`. The same
certificate and key authenticate the APNs connection, so there is no separate APNs key.

## DynamoDB (S6 builds the table)

Table `compass-<env>`: partition key `pk` (S), sort key `sk` (S), on demand, TTL attribute `ttl`
(number, epoch seconds), point-in-time recovery and deletion protection. GSI2 (`gsi2pk`, `gsi2sk`), strings, projection ALL. GSI1 is no longer used (the pass-keyed registration
copies below replaced it); S6 may drop it.

| Item                | pk                 | sk                                  | gsi2pk          | gsi2sk                                   |
| ------------------- | ------------------ | ----------------------------------- | --------------- | ---------------------------------------- |
| Pass_Record         | `PASS#<serial>`    | `PASS`                              | `SUB#<subHash>` | `PASS#<serial>`                          |
| Device_Registration | `DEV#<deviceHash>` | `REG#<serial>`                      | `SUB#<subHash>` | `REG#<deviceHash>#<serial>`              |
| Handoff_Record      | `HANDOFF#<sha256>` | `HANDOFF`                           | `SUB#<subHash>` | `HANDOFF#<sha256>`                       |
| Rate_Counter        | `RATE#<subHash>`   | `<kind>[:<scope>]#<windowStartSec>` | `SUB#<subHash>` | `RATE#<kind>[:<scope>]#<windowStartSec>` |

Two bookkeeping items per live record keep the caps exact when requests race, because the base table
can be read with a strongly consistent query and an index cannot: `ACTIVE#<subHash>` / `<serial>` (one
per live, non-voided pass, counted against the 80 active pass cap) and `PASSREG#<serial>` /
`<deviceHash>` (a copy of each registration, counted against the 10 devices cap and used to list a
pass's devices). Both carry `subHash`, `expiresAtMs`, `ttl` and `gsi2pk` / `gsi2sk`
(`ACTIVE#<serial>`, `PASSREG#<serial>#<deviceHash>`), so forget_me deletes them; they are not counted in its
`deleted`. The `api` and `passkit` roles need the same actions on them as on the other items.

Every read treats an item at or past its `expiresAtMs` as absent; TTL only cleans up later. `ttl` is
`expiresAtMs` (rounded up to seconds) or later: a pass and its registrations at the session end plus 24
hours, a hand-off at 15 minutes, a counter at its window end plus 120 seconds. Rate counters are never
deleted by forget_me.

Limits (one-hour windows aligned to the epoch hour): 60 pass writes (issue counts one per pass; update
and void are counted but never refused), 10 hand-offs, 5 forget_me calls (over it the data is still
erased and the fan-out skipped), 120 updates per attendee and 20 per pass that fan out (over them the
update is stored and Last_Updated advances, but no push or Google patch is sent; void always fans out),
30 reads per hand-off, at most 10 live registrations per pass (the 11th gets 200 and is not stored),
and 80 active passes per attendee.

## Metrics

CloudWatch embedded metric format, namespace `Compass`, the single dimension `Function` (`api` or
`passkit`), plus `Latency`. Counts only: `ApnsFailure`, `ApnsInvalidToken`, `ApnsSkipped`,
`GoogleWalletFailure`, `GoogleSaveJwtOversize`, `PasskitLogMessages`. Alarm on `ApnsFailure`.

Logs hold one JSON line per request: `requestId`, `route` (method plus template, or `UNMATCHED`),
`status`, `latencyMs`, `outcome`, `Function`, `Latency`, the metric counts and `_aws`. Never a path
value, header, body, token, serial, device id, push token, SubHash or error message.

## Permissions

- `api`: `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `Query` on the
  table and both GSIs; `secretsmanager:GetSecretValue` on the four secrets; outbound HTTPS to the JWKS
  host, `api.push.apple.com`, `walletobjects.googleapis.com` and `oauth2.googleapis.com`.
- `passkit`: `dynamodb:GetItem`, `PutItem`, `DeleteItem`, `Query` on the table and GSI1, with `PutItem`
  and `DeleteItem` limited by `dynamodb:LeadingKeys` to `DEV#*`; `secretsmanager:GetSecretValue` on
  `app`, `origin-verify` and `apple-pass` only (it never reads `google-wallet`).

Responses except getHealth carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`; no CORS header is ever set. The hand-off `.pkpasses` and `.ics`
downloads are attachments with fixed names (`reinvent-passes-<n>.pkpasses`, `reinvent.ics`). A
hand-off is not single-use within its 15 minutes.

## forget_me

The call reads the caller's items, deletes them, then pushes the void to registered devices and sets
Google objects `INACTIVE` from the in-memory copy, within a time budget and best effort. Apple passes
stay on the phone until they expire (the attendee is told to delete them); Google objects go inactive
and Google keeps its own copy of the object.

## Local harness (owner-run, SP3 and SP4)

```
HARNESS_PASS_TYPE_ID=... HARNESS_TEAM_ID=... \
HARNESS_SIGNER_CERT_FILE=... HARNESS_SIGNER_KEY_FILE=... HARNESS_WWDR_FILE=... \
PUBLIC_BASE_URL=http://<lan-ip>:8443 PASSKIT_WEB_SERVICE_PATH=/api/passkit \
TABLE_NAME=local APP_SECRET_ID=local-app ORIGIN_VERIFY_SECRET_ID=local-origin APPLE_SECRET_ID=local-apple \
EVENT_TIMEZONE=... EVENT_WINDOW_START=... EVENT_WINDOW_END=... ID_TOKEN_ISSUER=... SERVICE_VERSION=local \
node packages/pass-service/scripts/run.mjs packages/pass-service/scripts/local-harness.ts
```

Optional: `HARNESS_HOST` (default `0.0.0.0`), `HARNESS_PORT` (default `8443`),
`HARNESS_SIGNER_KEY_PASSPHRASE` when the key file is encrypted, `HARNESS_GOOGLE_KEY_FILE` and
`HARNESS_GOOGLE_ISSUER_ID` plus `GOOGLE_SECRET_ID` and `GOOGLE_WALLET_CLASS_SUFFIX` for the Google
spike (set `GOOGLE_WALLET_ENABLED=false` otherwise). It serves both Lambdas on `node:http` with an
in-memory table, generates the pepper and origin value at start-up, and treats the bearer text typed on
its page as the identity (a stand-in for sign-in; it never sees a real token). It prints only
`listening` and one Request_Logger line per request. Its page issues, updates, voids, hands off and
repeat-inserts passes for made-up sessions.

## Spike settings (design, Owner-run spike checklist)

- SP2: `ID_TOKEN_VERIFIER=cognito` and `ID_TOKEN_ISSUER=<iss>` when `iss` matches the Cognito pattern and
  the spike prints `verified`; otherwise `oidc` with `ID_TOKEN_ISSUER` and `ID_TOKEN_JWKS_URI`.
- SP3: `PASSKIT_WEB_SERVICE_PATH` (default `/api/passkit`), `APNS_PUSH_TYPE` (unset, then `background`,
  then `alert` if no fetch arrives) and `APNS_ENABLED=false` as the fallback.
- SP4: `GOOGLE_WALLET_CLASS_SUFFIX`, `GOOGLE_WALLET_ENABLED=false` if access is refused.

Image sizes of the pass artwork (icon 29 by 29 points, logo up to 160 by 50, at 1x, 2x and 3x) come
from Apple's published guidance; the live Wallet pages could not be fetched while building, so check
them on a device in SP3.

## ADR-026 re-check (task 22.7)

Read from the shipped `passkit-generator` 3.7.0 sources in `node_modules` (`lib/esm`):

- node-forge is used only in `Signature.js`: `pki.certificateFromPem` and `pki.decryptRsaPrivateKey` on
  the owner's own certificate and key, `pkcs7.createSignedData` and `sign` to create the detached
  signature, and the SHA-1 digest helpers. No file calls any node-forge verify function, so the
  advisory about RSA PKCS#1 v1.5 signature verification (GHSA-86w9-cpqp-85rv) does not apply to the code
  paths this service uses. The tests verify signatures with `node:crypto`, never with node-forge.
- joi validates dates with `isoDate()` only for `expirationDate`, `relevantDate`, relevant date intervals
  and semantic dates. This service never passes a client date string: `pass.json` is handed over without
  its dates, and the expiration and relevant dates are set with `Date` objects whose canonical
  24-character `toISOString()` form passkit-generator writes itself (review H1). Client text reaches joi
  only as the `value` of a pass field, which joi checks as a plain string first, and only after
  `createPassFieldsSchema` (with its date length bounds) has accepted it. No attacker-controlled message
  or schema reaches joi (GHSA-6h2x-m376-mqjq and GHSA-wr44-6hxh-3jwq).
- ADR-026 itself is unchanged by this review.
