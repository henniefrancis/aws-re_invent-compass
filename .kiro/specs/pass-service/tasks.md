# Implementation Plan: pass-service (S5)

## Overview

This plan turns the pass-service design into incremental TypeScript coding steps for `@compass/pass-service`, owning `packages/pass-service/**`, with tests under `packages/pass-service/test/`, mirroring `src/`.

The build order is bottom up: configuration and the HTTP primitives first, then the secrets provider, hashing helpers, origin guard and request pipeline, then the token verifier, then the data layer, rate limiter and validators, then the Apple pass builder and signer, the APNs client and the Google Wallet client, then the attendee handlers (issue, download, update, void), the hand-off, forget_me and health, then the PassKit web service, then the contract and security suites, then the production wiring, the Lambda entries and the owner-run local harness, then the deterministic build, the README, the three spike follow-ups and the screenshots. Each step ends integrated; nothing is left orphaned.

Every correctness property from the design (Properties 1 to 37) is implemented with `fast-check` (at least 100 runs), tagged `// Feature: pass-service, Property {n}: {title}`, and placed with the code it checks. All tests are mandatory; there are no optional tasks, because S5's definition of done requires 100% coverage.

Conventions followed: kebab-case files, PascalCase types, `Schema` suffix for zod schemas, shared types imported from `@compass/contracts` only (never redefined; `packages/contracts/**` and `contracts/**` never edited), vitest 4 with v8 coverage at 100% for `packages/pass-service/src/**` with `src/lambda-entry/*.ts` as the only named exclusion, no network in tests, Conventional Commits scoped `pass-service`.

## Execution rules (read before starting)

1. **Tasks run sequentially in numeric order.** Do task 1 fully, then task 2, and so on. There are no parallel waves.
2. **Do each task yourself in this chat.** Do not delegate tasks to the spec-task-execution subagent. Save files after each step.
3. **File ownership is strict.** Every file you touch must be under `packages/pass-service/**` or `.kiro/specs/pass-service/`, except the screenshots folder in task 30. Never edit `packages/contracts/**`, `contracts/**`, `infra/**`, `scripts/**` (the repository-level folder, owned by S6), `docs/decisions/**`, any other package, the root configs, `package.json` or `package-lock.json`. If you need a dependency or a contract change, stop and tell the owner; do not run `npm install`.
4. **Three dependencies must be added by the integrator first** (see Notes): `zod` 4.6.7 before task 3, `node-forge` 1.4.0 (devDependency) before task 12, and `ical-generator` 11.1.2 before task 17. If one is missing when its task starts, stop and ask; do not work around it.
5. **Secrets never enter the repository or the tests.** No certificate, key, passphrase, pepper, issuer id, Team ID, Pass Type ID value, token or device identifier is ever written to a file, a test, a fixture, a log or a commit. Tests generate Throwaway_PKI in memory at run time. No test calls Secrets Manager, DynamoDB, APNs, Google or a JWKS endpoint; each is injected and faked, apart from loopback servers the tests start themselves.
6. **Each top-level task ends with a local commit, made only after that task's tests pass** (`npm test` green with coverage on) and after `npx eslint .` and `npx prettier --check .` both pass with zero errors. Use Conventional Commits with scope `pass-service`, the subject and the body each passed with its own `-m` flag (never a commit message file), and no `Co-Authored-By` line or any AI attribution. Never push, merge, open a PR or tag. The first commit (task 1) also includes `.kiro/specs/pass-service/`. Verify every edit landed before committing.
7. **Never run a deploy or create AWS resources.** The owner runs every spike, deploy and real-device check. Tasks 26 to 28 apply spike results only after the owner records them; until then the defaults are the build plan's expected values and fallbacks. If a result has not arrived when you reach its task, leave that task open, say so, and continue.
8. No em dashes or en dashes in any file, comment, test name or commit message.
9. `fast-check` 4.10.2, `esbuild` 0.28.2 and `ical.js` 2.2.1 are root devDependencies and resolve from `packages/pass-service` tests and scripts; no install is needed for them.

## Tasks

- [x] 1. Scaffold the package and the configuration
  - [x] 1.1 Prepare the package layout
    - Create `src/node-types.d.ts` with a triple-slash reference to the Node types (TypeScript 6 does not load them by default), and the `src/` folders named in the design (`config`, `http`, `observability`, `secrets`, `security`, `auth`, `data`, `validation`, `apple`, `artwork`, `apns`, `google`, `calendar`, `services`, `handlers/api`, `handlers/passkit`, `app`, `wiring`, `harness`, `build`, `lambda-entry`)
    - Adjust `packages/pass-service/tsconfig.json` only if needed for the folders above; keep `src/index.ts` compiling (it will export `createApiApp` and `createPasskitApp` from task 5)
    - Create a `packages/pass-service/README.md` stub with a one-paragraph purpose; it is completed in task 25
    - _Requirements: 1.7, 26.1_

  - [x] 1.2 Implement configuration parsing
    - Create `src/config/config.ts` with `parseApiConfig`, `parsePasskitConfig`, `webServiceUrl` and `ConfigError` per design Component 1: every variable in the design's environment table, defaults (`/api/passkit`, `cognito`, client id `7vmom55m1qstvq8i71ph127bfq`, `api.push.apple.com`, timeouts 2000 and 4000 ms, cache 300 s, Google and calendar enabled), Cognito user pool id parsed from the issuer, `oidc` requiring an `https` JWKS URI, `https` base URL unless `allowHttpBaseUrl`, IANA timezone and ISO-with-offset window checks, `APNS_PUSH_TYPE` limited to `alert` or `background`
    - `ConfigError` names the variable and never contains a value
    - _Requirements: 4.9, 9.8, 24.1, 24.2, 24.3, 24.4, 24.5_

  - [x] 1.3 Write property test for configuration parsing
    - **Property 36: Configuration parses or fails closed without echo**
    - **Validates: Requirements 9.8, 24.1, 24.2, 24.3, 24.4, 24.5**

  - [x] 1.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Include `.kiro/specs/pass-service/` in this first commit. Verify every edit landed. Never push.

- [x] 2. Implement the HTTP primitives and the request logger
  - [x] 2.1 Implement proxy types, responses, problems and the router
    - Create `src/http/event.ts` (`ProxyEvent`, `ProxyResult`, case-insensitive `header`), `src/http/problem.ts` (`ProblemCode`, `ProblemError`, `problem()` with `type: "about:blank"` and the fixed reason-phrase table), `src/http/responses.ts` (`json`, `binary` with base64 and `isBase64Encoded: true`, `empty`) and `src/http/router.ts` (`createRouter` keyed by `${method} ${resource}`)
    - `problem()` has no parameter that can carry request input; every Problem body validates with `ProblemSchema` from `@compass/contracts`
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [x] 2.2 Implement the request logger, metrics and console guard
    - Create `src/observability/request-logger.ts` (one JSON line built from an allowlist: `requestId`, `route`, `status`, `latencyMs`, `outcome`, `Function`, `_aws` in CloudWatch embedded metric format with namespace `Compass` and the single dimension `Function`, `Latency` and the metric counts), `src/observability/metrics.ts` (the six metric names) and `src/observability/console-guard.ts` (`withConsoleGuard` silencing `console` during a request)
    - `route` is `${method} ${resource}` or `UNMATCHED`, never the raw path
    - _Requirements: 22.1, 22.2, 22.4, 22.5_

  - [x] 2.3 Write unit tests for the HTTP primitives and logger
    - Problem bodies for each status and code parse with `ProblemSchema`; binary responses are base64 with the given content type; the router returns undefined for unknown keys; a log line has exactly the allowlisted keys; the console guard restores `console` after success and after a throw
    - _Requirements: 2.5, 2.7, 2.8, 22.1, 22.5_

  - [x] 2.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 3. Implement the secrets provider
  - [x] 3.1 Implement the secrets provider and the AWS source
    - Create `src/credentials/secret-shapes.ts` (zod schemas for the app, apple-pass and google-wallet JSON keys in the design's secrets table) and `src/credentials/secrets-provider.ts` (`createSecretsProvider` with a per-secret cache of `SECRETS_CACHE_TTL_SECONDS`, single-flight refresh, failures not cached, `DependencyError('secret')` without any value) and `awsSecretSource` over `GetSecretValueCommand` (SecretString only)
    - _Requirements: 21.1, 21.2, 21.3, 21.6_

  - [x] 3.2 Write property test for the secrets cache
    - **Property 34: Secrets are fetched once per period and never leak**
    - **Validates: Requirements 21.1, 21.2, 21.3**

  - [x] 3.3 Write unit tests for the AWS secret source
    - Mock `SecretsManagerClient.send` only (never a real client call); assert the command input, SecretString handling, and that a missing SecretString becomes a `DependencyError` with no value
    - _Requirements: 21.1, 21.3, 21.5_

  - [x] 3.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 4. Implement the hashing and capability helpers
  - [x] 4.1 Implement hashing, the Auth_Token derivation and the hand-off id
    - Create `src/security/hashing.ts` (`subHash`, `deviceHash`, `sha256Hex`, `constantTimeEqualHex` with `timingSafeEqual`), `src/security/auth-token.ts` (`deriveAuthToken` as base64url HMAC-SHA256 of `compass-apple-auth-token-v1:` plus the serial, 43 characters) and `src/security/handoff-id.ts` (`newHandoffId` from 16 injected random bytes, `HANDOFF_ID_PATTERN`, `UUID_V4_PATTERN`)
    - _Requirements: 4.7, 9.9, 15.1, 17.7, 19.4_

  - [x] 4.2 Write unit tests for the helpers
    - Lengths and alphabets, determinism, pepper sensitivity, constant-time comparison on equal and unequal lengths, UUID v4 and hand-off id patterns
    - _Requirements: 4.7, 9.9, 15.1_

  - [x] 4.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 5. Implement the origin guard and the request pipeline
  - [x] 5.1 Implement the origin guard
    - Create `src/security/origin-guard.ts` with `checkOrigin(event, appSecret)` comparing `x-origin-verify` in constant time; an absent header is false
    - _Requirements: 3.1_

  - [x] 5.2 Implement the request pipeline and the two app factories
    - Create `src/app/pipeline.ts` (timer, console guard, origin guard before anything else with a 403 `forbidden`, router lookup with 404 for unknown keys, `ProblemError` mapping, any other throw mapped to 500 `internal_error` and never rethrown, one log line per request) and `src/app/api-app.ts` and `src/app/passkit-app.ts` (`createApiApp(deps)`, `createPasskitApp(deps)` with empty route tables filled by later tasks); export both from `src/index.ts`
    - _Requirements: 2.7, 3.2, 3.3, 22.1, 22.3_

  - [x] 5.3 Write property test for the origin guard
    - **Property 3: The Origin_Guard admits exactly the matching header**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 5.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 6. Implement the ID token verifier
  - [x] 6.1 Implement the token verifier
    - Create `src/auth/bearer.ts` (`parseBearer`, at most 8192 characters, three base64url segments) and `src/auth/token-verifier.ts` (`createTokenVerifier`): `decomposeUnverifiedJwt` from `aws-jwt-verify/jwt` and an `alg === 'RS256'` check first; `CognitoJwtVerifier.create({userPoolId, tokenUse: 'id', clientId}, {jwksCache})` in `cognito` mode; `JwtVerifier.create({issuer, audience: clientId, jwksUri}, {jwksCache})` plus a `token_use === 'id'` check in `oidc` mode; `subHash(pepper, sub)` as the only output; every failure mapped to the same 401 `unauthorized`; the `email` claim never read
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 6.2 Create the throwaway token helpers
    - Create `test/helpers/jwt-factory.ts`: RSA key pairs and a JWKS from `node:crypto` (`generateKeyPairSync`, `KeyObject.export({format: 'jwk'})`), tokens with any header and claims signed with `createSign('RSA-SHA256')`, plus `alg: none` and HS256 variants; and a counting fake `fetcher` for `SimpleJwksCache` with a short `SimplePenaltyBox`
    - _Requirements: 25.5, 25.8_

  - [x] 6.3 Write property test for token acceptance
    - **Property 4: A token is accepted exactly when every rule holds**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [x] 6.4 Write property test for the JWKS cache
    - **Property 5: The JWKS is fetched at most once per kid, with one refetch for an unknown kid**
    - **Validates: Requirements 4.6**

  - [x] 6.5 Write the named JWT negative tests
    - One test each for wrong `aud`, wrong `iss`, `alg: none`, expired, unknown `kid`, plus bad signature and wrong `token_use`, each asserting the identical 401 body
    - _Requirements: 4.5, 25.3_

  - [x] 6.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the data layer
  - [x] 8.1 Implement the table client and its DynamoDB adapter
    - Create `src/data/keys.ts` (the design's key formats) and `src/data/table-client.ts` (`TableClient`) and `src/data/dynamo-table-client.ts` (`createDynamoTableClient` over `DynamoDBDocumentClient`: `GetCommand`, `PutCommand` with `attribute_not_exists(pk)`, `UpdateCommand` with a version condition, `DeleteCommand` with `ReturnValues: 'ALL_OLD'`, paginated `QueryCommand` on the table, GSI1 and GSI2 with `begins_with`, and the conditional `ADD` counter); map `ConditionalCheckFailedException` to the result values and anything else to `DependencyError('dynamodb')`
    - _Requirements: 6.6, 19.1_

  - [x] 8.2 Implement the in-memory table
    - Create `src/harness/memory-table.ts`, a `TableClient` over a `Map` with the same conditional and query semantics and an interleaving hook for concurrency tests; it is used by the tests and by the local harness (task 23)
    - _Requirements: 24.7, 25.8_

  - [x] 8.3 Implement the repositories
    - Create `src/data/pass-repository.ts`, `src/data/registration-repository.ts` and `src/data/handoff-repository.ts` per design Component 8, with `isLive(item, now)` applied on every read, `ttl` set to the ceiling of `expiresAtMs` in seconds or later, and `nextLastUpdated(previousMs, nowMs)` in `src/data/last-updated.ts`
    - _Requirements: 11.5, 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 8.4 Write property test for Last_Updated
    - **Property 16: Last_Updated strictly increases at second precision**
    - **Validates: Requirements 11.5, 18.4, 18.5**

  - [x] 8.5 Write unit tests for the adapter and repositories
    - Assert each DynamoDB command input (mocked `send` only), each condition failure mapping, query pagination, and that each repository returns undefined for an expired item still present in the table
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 8.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 9. Implement the rate limiter
  - [x] 9.1 Implement the fixed-window limiter
    - Create `src/data/rate-limiter.ts` with `consume` (conditional `addCounter`, refuse when count plus units exceeds 60 pass writes or 10 hand-offs in the epoch-hour window, `retryAfterSeconds` at least 1) and `record` (unconditional add for update and void), counters keyed `RATE#<subHash>` and `<kind>#<windowStartSec>` with `expiresAtMs` at the window end and `ttl` 120 seconds later; export `ACTIVE_PASS_LIMIT = 80`
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7_

  - [x] 9.2 Write property test for the limiter
    - **Property 8: The fixed-window limiter allows exactly up to the limit, atomically**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6, 6.7**

  - [x] 9.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 10. Implement request and response validation
  - [x] 10.1 Implement the request validators
    - Create `src/validation/request-schemas.ts` with `parseJsonBody` (64 KiB cap), `assertKnownKeys` with key shapes taken from the contract (PassFields and its nested objects, IssuePassesRequest, CreateHandoffRequest, DeviceRegistration, LogEntries), `parseIssueRequest` (1 to 2 distinct platforms, 1 to 25 passes, distinct session codes, each through `createPassFieldsSchema(window)`), `parsePassFields`, `parseHandoffRequest` (1 to 80 distinct UUID v4 serials, at least one include flag), `parseRegistrationBody` (1 to 256 hex characters, else 401) and `parseLogBody` (count only); every failure is the same 400 `invalid_request`, and no value is trimmed or normalised
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 15.4, 17.5, 18.7_

  - [x] 10.2 Implement the response schemas
    - Create `src/validation/response-schemas.ts`, each schema declared as `z.ZodType<CompassApi['components']['schemas']['<Name>']>` for Health, IssuePassesResponse, UpdatePassResponse, VoidPassResponse, CreateHandoffResponse, HandoffView, ForgetMeResponse and SerialNumbers
    - _Requirements: 2.4_

  - [x] 10.3 Write property test for request validation
    - **Property 10: PassFields acceptance equals the shared schema plus strictness**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**

  - [x] 10.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement the Apple pass builder and signer
  - [x] 12.1 Create the original artwork
    - Check Apple's current Wallet design guidance for icon and logo image sizes, then create `src/artwork/png.ts` (a small PNG encoder over `node:zlib`) and `src/artwork/draw.ts` (an original compass-rose glyph and "Compass" wordmark in an original palette with at least 4.5 to 1 text contrast, no AWS logo, colour or wording), and `scripts/make-artwork.ts`, which writes `src/apple/artwork.ts` holding `icon.png`, `icon@2x.png`, `icon@3x.png`, `logo@2x.png` and `logo@3x.png` as base64 constants; run it once and commit the generated module
    - _Requirements: 1.6, 9.10_

  - [x] 12.2 Create the throwaway PKI helper
    - Create `test/helpers/throwaway-pki.ts` that generates in memory, once per test run, with `node-forge`: a CA certificate standing in for WWDR, a Pass Type ID signer certificate issued by it, and the signer key encrypted with a random passphrase, all as PEM strings; plus a Google service account key pair from `node:crypto`; nothing is written to the repository
    - _Requirements: 21.4, 21.5, 25.8_

  - [x] 12.3 Implement the pass template
    - Create `src/apple/pass-template.ts` (`buildPassJson`, `relevantInterval`, `boardingClosesAt`) and `src/apple/format-time.ts` (`formatEventTime` with `Intl` in the event timezone, timezone named once on the back) per the design's template table: `boardingPass` with `PKTransitTypeGeneric`, the disclaimer on front and back, no barcode, `sharingProhibited: true`, `formatVersion: 1`, `expirationDate` and `voided`, the relevant interval, "Venue not published", `webServiceURL`, `authenticationToken`, attendee name only when sent
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.11_

  - [x] 12.4 Write property test for the pass template
    - **Property 13: Every Apple pass.json follows the fixed template**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.11**

  - [x] 12.5 Implement the signer and the bundle builder
    - Create `src/apple/pass-signer.ts` (`createPassSigner`: in-memory buffers for `pass.json` and the artwork, `new PKPass(buffers, {wwdr, signerCert, signerKey, signerKeyPassphrase}, props)`, `setBarcodes(null)`, `setExpirationDate`, `setRelevantDates`, `getAsBuffer`; `signBundle` with `PKPass.pack`; every call inside the console guard) and `chunkBundles` (chunks of at most 10 in order); if `passkit-generator` refuses a past `expirationDate` for a voided pass, record how it was resolved under "Implementation deviations" in design.md
    - _Requirements: 9.1, 9.10, 10.1, 10.2, 16.2, 16.3, 22.5_

  - [x] 12.6 Write property test for signed passes and bundles
    - **Property 14: Signed passes and bundles are intact**
    - **Validates: Requirements 9.1, 9.10, 10.1, 16.3**

  - [x] 12.7 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 13. Implement the APNs client
  - [x] 13.1 Implement the APNs client and connector
    - Create `src/apns/http2-connector.ts` (`http2.connect` with the PEM certificate, key and passphrase, optional `ca` for tests only) and `src/apns/apns-client.ts` (`createApnsClient`: one session per call, concurrent streams, `POST /3/device/<pushToken>`, `apns-topic` equal to the Pass Type ID, `apns-push-type` only when configured, body `{}`, per-push timeout and total budget, 410 or 400 `BadDeviceToken` as invalid, any other outcome as failed, no retry, `skipped` when disabled)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 13.2 Create the loopback HTTP/2 test server
    - Create `test/helpers/apns-stand-in.ts`: an `http2.createSecureServer` on 127.0.0.1 using the throwaway PKI, which records requests and answers each push with a scripted status, reason and delay
    - _Requirements: 25.8_

  - [x] 13.3 Write property test for APNs requests and replies
    - **Property 19: APNs requests and replies are handled exactly**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

  - [x] 13.4 Write property test for the push budget
    - **Property 20: Pushes stay inside the time budget**
    - **Validates: Requirements 13.5, 13.6**

  - [x] 13.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 14. Implement the Google Wallet client
  - [x] 14.1 Implement the generic object builder
    - Create `src/google/google-object.ts` (`buildGenericObject`: `id` `<issuerId>.<serial>`, `classId` `<issuerId>.<suffix>`, `state`, `cardTitle`, `header`, `subheader`, `textModulesData` with gate, boarding closes, start and the disclaimer, `hexBackgroundColor`, `validTimeInterval.end.date` equal to `endsAt`, no `barcode`, no `logo`)
    - _Requirements: 14.1_

  - [x] 14.2 Implement the REST client and the token source
    - Create `src/google/google-wallet-client.ts` (`insert` with `POST https://walletobjects.googleapis.com/walletobjects/v1/genericObject` and a 409 fallback to one patch, `patch` with `PATCH .../genericObject/{resourceId}`, timeouts, `'failed'` on any other non-2xx or network error) over an injected `fetch`, and `src/google/token-source.ts` (`createGoogleTokenSource` with `google-auth-library` `JWT({email, key, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']})`); the client never logs content, ids, keys or tokens
    - _Requirements: 14.2, 14.3, 14.4, 14.7, 14.8_

  - [x] 14.3 Implement the save JWT
    - Create `src/google/save-jwt.ts` (`signSaveJwt` with `node:crypto` RS256; claims `iss`, `aud: 'google'`, `typ: 'savetowallet'`, `iat`, `origins: []`, `payload.genericObjects` of `{id, classId}`; link `https://pay.google.com/gp/v/save/<jwt>`; oversize flag above 1800 characters)
    - _Requirements: 14.5, 14.6_

  - [x] 14.4 Write property test for the object mapping
    - **Property 21: Google objects follow the fixed mapping**
    - **Validates: Requirements 14.1**

  - [x] 14.5 Write property test for the REST calls
    - **Property 22: Google REST calls use the documented endpoints**
    - **Validates: Requirements 14.2, 14.3, 14.4**

  - [x] 14.6 Write property test for the save JWT
    - **Property 23: Save links carry a verifiable RS256 JWT**
    - **Validates: Requirements 14.5, 14.6**

  - [x] 14.7 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement the pass lifecycle and the attendee pass handlers
  - [x] 16.1 Implement issue in the lifecycle service
    - Create `src/services/pass-lifecycle.ts` with `issue`: active-pass cap (429 `active_pass_limit`, no `Retry-After`), `consume('passWrites', n)` (429 `rate_limited` with `Retry-After`), then per pass `randomUUID`, `deriveAuthToken`, `sha256Hex`, `putIfAbsent`, then a Google insert when requested and enabled, returning platforms that succeeded in request order; with Google disabled no Google call is made
    - _Requirements: 6.2, 6.4, 8.1, 8.2, 8.3, 8.4, 8.5, 14.7_

  - [x] 16.2 Implement the issuePasses and getApplePass handlers
    - Create `src/handlers/api/issue-passes.ts` (verify, parse, issue, 201) and `src/handlers/api/get-apple-pass.ts` (verify, owner match with `constantTimeEqualHex`, sign on demand, 200 `application/vnd.apple.pkpass`; unknown, expired, foreign and non-UUID serials all the same 404); register both routes in `createApiApp`
    - _Requirements: 5.1, 5.2, 5.3, 8.5, 10.1, 10.2_

  - [x] 16.3 Write property test for issue
    - **Property 11: Issue creates exactly the right records**
    - **Validates: Requirements 8.1, 8.2, 8.5, 19.3**

  - [x] 16.4 Write property test for Google degradation
    - **Property 12: A Google failure or a disabled Google degrades only the platform list**
    - **Validates: Requirements 8.3, 8.4, 14.7**

  - [x] 16.5 Write property test for the active-pass cap
    - **Property 9: The active-pass cap refuses issue only, and update and void are never refused**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 16.6 Write property test for the owner match
    - **Property 7: A non-owner is indistinguishable from an unknown serial**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 16.7 Implement update and void
    - Add `update`, `void` and `voidRecord` to the lifecycle service per design Component 14 (owner match, active check, session code equality, `record('passWrites', 1)`, version-checked save with one re-read retry, `nextLastUpdated`, `extendExpiry` on registrations, pushes to `listByPass` with invalid registrations deleted and metrics recorded, Google patch or `INACTIVE` with `googleState` kept, idempotent repeat void retrying only a pending Google patch), and create `src/handlers/api/update-pass.ts` and `src/handlers/api/void-pass.ts`; register both routes
    - _Requirements: 6.5, 7.5, 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.3, 12.4, 13.3, 13.4, 13.6_

  - [x] 16.8 Write property test for update
    - **Property 17: Update replaces content, bumps once and pushes once per device**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [x] 16.9 Write property test for void idempotence
    - **Property 18: Void is idempotent**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

  - [x] 16.10 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 17. Implement the hand-off and the calendar
  - [x] 17.1 Implement hand-off creation
    - Create `src/services/handoff-service.ts` with `create` (every serial live, active and owned, else one 400; `consume('handoffs', 1)`; `newHandoffId`; store only its SHA-256 with `expiresAtMs = now + 900000`; `boardUrl` from the base URL plus `/board#h=`) and `src/handlers/api/create-handoff.ts`; register the route
    - _Requirements: 6.3, 15.1, 15.2, 15.3, 15.4, 19.4_

  - [x] 17.2 Write property test for hand-off creation
    - **Property 24: Hand-off creation stores only a hash and a 15-minute expiry**
    - **Validates: Requirements 15.1, 15.2, 19.3, 19.4**

  - [x] 17.3 Write property test for foreign serials
    - **Property 25: Hand-off creation refuses foreign serials uniformly**
    - **Validates: Requirements 15.3, 15.4**

  - [x] 17.4 Implement the view, the bundle download and the calendar
    - Add `view`, `appleBundle` and `calendar` with a shared `resolve(handoffId, now)` (pattern, hash lookup, expiry, active passes in stored order, one 404 for every failure); create `src/calendar/calendar-builder.ts` with `ical-generator` (UTC, `UID` equal to the serial, `SUMMARY`, `LOCATION`, `DESCRIPTION` with boarding closes and the disclaimer, a display alarm at boarding closes); return `calendarPath: null` and 404 `not_enabled` when the calendar is disabled; return `google: null` unless Google is included, enabled and at least one active pass has a Google object; create `src/handlers/api/get-handoff.ts`, `get-handoff-apple-bundle.ts` and `get-handoff-calendar.ts`; register the routes
    - _Requirements: 14.7, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 19.2_

  - [x] 17.5 Write property test for the hand-off view
    - **Property 26: The hand-off view lists exactly the active passes and their bundles**
    - **Validates: Requirements 14.7, 16.1, 16.2, 16.3, 16.4**

  - [x] 17.6 Write property test for hand-off expiry
    - **Property 27: Unknown and expired hand-offs look the same**
    - **Validates: Requirements 16.7, 19.2**

  - [x] 17.7 Write property test for the calendar
    - **Property 28: The hand-off calendar is valid RFC 5545**
    - **Validates: Requirements 16.5, 16.6**

  - [x] 17.8 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 18. Implement forget_me and health
  - [x] 18.1 Implement the forgetMe and getHealth handlers
    - Create `src/handlers/api/forget-me.ts` (verify; GSI2 query for `SUB#<subHash>`; `voidRecord` for each live active pass; delete every returned item and every registration found through GSI1 for those passes; 202 `{voided, deleted}`) and `src/handlers/api/health.ts` (origin check only, 200 `{status: 'ok', version}`, no table and no other secret); register both routes
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 23.1, 23.2_

  - [x] 18.2 Write property test for forget_me
    - **Property 33: forget_me removes exactly the caller's items**
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5**

  - [x] 18.3 Write unit tests for health
    - 200 body shape and version; no table access and no apple or google secret read
    - _Requirements: 23.1, 23.2_

  - [x] 18.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 19. Implement the PassKit web service
  - [x] 19.1 Implement authorisation, register and unregister
    - Create `src/handlers/passkit/authorize-apple-pass.ts` (header pattern, configured pass type, UUID v4 serial, live record, constant-time hash comparison with a dummy comparison for unknown serials, one 401), `register-device.ts` (identifier check, push token check, `deviceHash`, `upsert` copying the pass's SubHash and expiry; 201 created, 200 updated) and `unregister-device.ts` (delete if present, 200); register both routes in `createPasskitApp`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x] 19.2 Write property test for registration
    - **Property 29: Registration follows Apple's state machine**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7**

  - [x] 19.3 Write property test for the Auth_Token
    - **Property 15: The Auth_Token is derived, verifiable and never stored**
    - **Validates: Requirements 9.9, 17.1, 19.4**

  - [x] 19.4 Implement serial numbers, latest pass and log
    - Create `get-serial-numbers.ts` (204 for an invalid identifier, unknown device or other pass type; tag absent or not `^\d{1,16}$` treated as 0; 200 `{serialNumbers, lastUpdated}` as decimal epoch milliseconds, or 204), `get-latest-pass.ts` (authorise; `If-Modified-Since` parsed as an HTTP date; 304 when at or after Last_Updated in whole seconds; else sign and return 200 with `Last-Modified`) and `log-messages.ts` (count only, `PasskitLogMessages` metric, 200); register the routes
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x] 19.5 Write property test for the updatable list
    - **Property 30: The updatable list is exact**
    - **Validates: Requirements 18.1, 18.2, 18.3**

  - [x] 19.6 Write property test for If-Modified-Since
    - **Property 31: The latest pass honours If-Modified-Since**
    - **Validates: Requirements 18.4, 18.5, 18.6**

  - [x] 19.7 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Prove contract conformance
  - [x] 21.1 Type the route tables against the contract and read the YAML
    - Add a compile-time mapping from both route tables onto `CompassApi['paths']` so a missing or extra path or method fails `tsc`, and create `test/helpers/openapi-reader.ts`, a small indentation-based reader of `contracts/compass-api.openapi.yaml` that returns each path, method, `operationId` and response status (no YAML dependency)
    - _Requirements: 2.1, 2.2, 25.7_

  - [x] 21.2 Write a contract test for every operation
    - For each of the 15 operations: the router serves exactly the contract's method and path; every listed status except 500 is driven through the app with in-memory dependencies; every JSON body validates against its contract-typed schema; binary responses carry the contract content type
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 25.7_

  - [x] 21.3 Write property test for contract conformance
    - **Property 2: Every response conforms to the contract**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 25.7**

  - [x] 21.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 22. Write the security and lifecycle suite
  - [x] 22.1 Write property test for no echo
    - **Property 1: Problem responses never echo input**
    - **Validates: Requirements 2.5, 2.6**

  - [x] 22.2 Write property test for keyed identity
    - **Property 6: Identity reduces to a keyed hash**
    - **Validates: Requirements 4.7, 4.8, 17.7, 19.4**

  - [x] 22.3 Write property test for expiry on every read
    - **Property 32: Expiry is enforced on every read**
    - **Validates: Requirements 19.1, 19.2, 19.3**

  - [x] 22.4 Write property test for the log allowlist (the log-redaction test)
    - **Property 35: Log lines hold only allowlisted fields**
    - Drive all 15 operations with known token, `sub`, email, serial, hand-off id, device identifier, push token, session code, title and body needles, including throwing handlers and console noise from stubbed third-party calls
    - **Validates: Requirements 22.1, 22.2, 22.3, 22.4, 22.5, 25.6**

  - [x] 22.5 Write the named security and lifecycle tests
    - PassKit 200, 201, 204, 304 and 401, one test each; hand-off read at 14 minutes 59 seconds succeeds and at exactly 15 minutes returns the unknown-id 404; 429 on issuePasses after 60 units and on createHandoff after 10, each with `Retry-After`, and the 81st active pass refused; PassFields rejection of a URL, a bare domain, U+202E, a control character, an out-of-window date and an 81-character title; void leads to an APNs push and a Google `INACTIVE` patch; TTL and expiry enforced on each item kind
    - _Requirements: 6.2, 6.3, 6.4, 7.2, 12.2, 16.7, 17.2, 18.2, 18.5, 19.2, 25.4, 25.5_

  - [x] 22.6 Write the structural guard tests
    - No test file imports `@aws-sdk/client-secrets-manager` except the secret-source adapter test (which mocks `send`); no file under `packages/pass-service` contains a PEM block, a private key header or a `.p12` reference to a real file; the Passkit_Lambda wiring never requests the google-wallet secret
    - _Requirements: 21.4, 21.5, 21.6, 25.8_

  - [x] 22.7 Re-check ADR-026
    - Confirm by reading the `passkit-generator` 3.7.0 source in `node_modules` that the code paths S5 uses do not call `node-forge` signature verification, and that every value reaching `joi` has already passed `createPassFieldsSchema` or comes from S5's fixed template; record the result in the README (any change to ADR-026 itself is a request for the integrator)
    - _Requirements: 26.1_

  - [x] 22.8 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 23. Wire production dependencies, the Lambda entries and the local harness
  - [x] 23.1 Implement the production wiring
    - Create `src/wiring/api-deps.ts` and `src/wiring/passkit-deps.ts` (shared pieces in `src/wiring/common.ts`) with `productionApiDeps` and `productionPasskitDeps`: parse configuration, build the DynamoDB document client, Secrets Manager client, JWKS cache and verifier, HTTP/2 connector, Google token source and `fetch`-based client at module scope so they are reused across invocations; the passkit wiring never builds Google pieces
    - _Requirements: 4.6, 21.1, 21.2, 21.6, 24.1_

  - [x] 23.2 Create the Lambda entry adapters
    - Create `src/lambda-entry/api.ts` and `src/lambda-entry/passkit.ts`, each a one-line `export const handler = createXApp(productionXDeps(process.env))` (the named coverage exclusion)
    - _Requirements: 1.2_

  - [x] 23.3 Implement the owner-run local harness
    - Create `src/harness/local-server.ts` (`startLocalHarness`: `node:http` server, request to `ProxyEvent` conversion matched against the 15 contract templates, the in-memory table from task 8.2, a file-based `SecretSource` reading the PEM and Google key files from paths in harness variables, a fixed origin value injected, `allowHttpBaseUrl`, a small page to issue, update, void, hand off and repeat-insert passes for made-up sessions) and `scripts/local-harness.ts` (thin launcher); it prints only "listening" and Request_Logger lines, never file contents, tokens or identifiers
    - _Requirements: 24.7_

  - [x] 23.4 Write tests for the wiring and the harness
    - Wiring builds both dependency sets from a valid environment without network calls and fails closed on an invalid one; the harness serves a full issue, register, latest-pass and void round trip over loopback with throwaway files in a temporary folder outside the repository, and its output contains no needle
    - _Requirements: 24.1, 24.7, 25.8_

  - [x] 23.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 24. Build the deterministic Lambda bundles
  - [x] 24.1 Implement the deterministic zip writer
    - Create `src/bundling/deterministic-zip.ts` (`zipDeterministic`: sorted entries, DOS time 1980-01-01 00:00, mode 0644, deflate with `zlib.deflateRawSync`, CRC with `zlib.crc32`, no extra fields)
    - _Requirements: 1.3, 1.4_

  - [x] 24.2 Write property test for the zip writer
    - **Property 37: The zip writer is deterministic**
    - **Validates: Requirements 1.3, 1.4**

  - [x] 24.3 Implement the bundler and the build script
    - Create `src/bundling/bundle-lambdas.ts` (`bundleLambdas` with `esbuild`: bundle, `platform: 'node'`, `target: 'node24'`, `format: 'esm'`, minify, no source maps, no legal comments, a `createRequire` banner for CommonJS dependencies, output `index.mjs`, zip, fail at 5 MB or more) and `scripts/build.ts` (writes `dist/lambda/api.zip` and `dist/lambda/passkit.zip`, prints names, sizes and SHA-256 values only)
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

  - [x] 24.4 Write the build test
    - Build into a temporary folder twice: exactly two zips, each with only `index.mjs`, byte-identical across runs, each under 5 MB, and the bundled `index.mjs` exports `handler`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 24.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 25. Write the README and the S6 hand-off
  - [x] 25.1 Complete the package README
    - Document both bundles (path, handler `index.handler`, `nodejs24.x`, `arm64`, the plan's memory and timeouts), every environment variable with meaning and default, the secret JSON keys per secret, how the owner converts the Apple `.p12` to the PEM values (per the `passkit-generator` documentation) without echoing them, the DynamoDB key schema and TTL attribute, the metrics and their meaning for S6's alarms, the permissions per Lambda, the harness variables and how to run it, the SP2, SP3 and SP4 settings, and the ADR-026 re-check result
    - _Requirements: 1.7, 26.1_

  - [x] 25.2 Record the integrator requests
    - Make sure the Notes section of this file lists every request for another stream that arose while building (dependencies, contract questions, S6 alignment items), with no change made outside `packages/pass-service/**`
    - _Requirements: 26.3_

  - [x] 25.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 26. Apply the SP2 result (done: the Cognito issuer is recorded in docs/spikes-results.md, dev runs `ID_TOKEN_VERIFIER=cognito` with that `ID_TOKEN_ISSUER` through the HCP workspace variables, and SP3 verified a live Builder ID token on dev on 19 October)
  - [x] 26.1 Adjust the verifier configuration to the recorded SP2 result
    - Once the owner has recorded the SP2 result (design, Owner-run spike checklist): if it confirms the Cognito issuer, record the `ID_TOKEN_ISSUER` value in the README for S6 and keep `cognito`; if another OIDC issuer verified, document `oidc` with the issuer and `jwks_uri`, and add a test case built on that issuer's shape; if offline verification failed, stop and raise build plan 5.4 step 3 with the owner and integrator (no code change here). Never record a token or claim value other than `iss`, `aud`, `alg` and `token_use`
    - _Requirements: 4.2, 4.3, 4.9, 24.2, 24.6_

  - [x] 26.2 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 27. Apply the SP3 result (recorded 19 October)
  - [x] 27.1 Adjust the PassKit and APNs configuration to the recorded SP3 result
    - Set the documented values for `PASSKIT_WEB_SERVICE_PATH` (path join), `APNS_PUSH_TYPE` (if a push type was needed) and the `apns-topic` behaviour; if `If-Modified-Since` was never sent, note it; if pushes never arrived, document `APNS_ENABLED=false` as the shipped setting for S6 and the SP3 fallback (passes expire at `expirationDate`; sync copy tells the attendee which pass to delete); if binary downloads failed through the dev edge, raise the binary media type question with the integrator; update tests only where a default changed
    - _Requirements: 13.2, 13.6, 24.3, 24.6_

  - [x] 27.2 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 28. Apply the SP4 result (waits on the owner; applied 31 October 2026, no code change: see `docs/spikes-results.md` "SP4 result")
  - [x] 28.1 Adjust the Google configuration to the recorded SP4 result
    - Record the `GOOGLE_WALLET_CLASS_SUFFIX` value for S6; if a duplicate insert does not answer 409, change the fallback condition to the recorded status and its test; if long save links failed, raise the several-save-URLs question with the integrator; if publishing access is not granted by 28 October, document "beta, test users" in the README (no code change); if access is refused, document `GOOGLE_WALLET_ENABLED=false` (cut-list item 10)
    - _Requirements: 14.3, 14.6, 14.7, 24.4, 24.6_

  - [x] 28.2 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 29. Final checkpoint - Ensure all tests pass and coverage is complete
  - Ensure all tests pass with 100% lines, branches, functions and statements for `packages/pass-service/src/**` (only `src/lambda-entry/*.ts` excluded), lint, format and typecheck clean, the build produces both zips under 5 MB, ask the user if questions arise.
  - _Requirements: 1.5, 25.1, 25.2_

- [x] 30. Capture feature screenshots for the Builder Center post
  - [x] 30.1 Save two or three captures of the feature working
    - Save two or three screenshots or short terminal captures to `docs/article/screenshots/pass-service/`, for example the contract and security suites passing, the build printing both bundle sizes and hashes, and the local harness log for an issue, register, update and void round trip with made-up sessions; if the owner provides SP3 or SP4 phone screenshots, add them only after checking they show no serial, device identifier, token or name
    - _Requirements: 26.2_

  - [x] 30.2 Commit
    - After `npx eslint .` and `npx prettier --check .` both pass with zero errors, commit the captures with scope `pass-service` (subject plus body via multiple `-m` flags, no attribution). Never push.

- [x] 31. Make the APNS host check an explicit exact match (CodeQL alert 4, design "Post-CodeQL change")
  - [x] 31.1 In `config.ts`, compare `APNS_HOST` to the allowed hosts with strict equality instead of `Array.prototype.includes`
    - Why: CodeQL js/incomplete-url-substring-sanitization read `APNS_HOSTS.includes(host)` as a substring test. It is an array, so it was already an exact match (a false positive), but the explicit form says so and keeps the scan clean
    - Tests: the existing config tests (an allowed host passes; `api.push.apple.com.evil.example` and a sandbox look-alike are refused) still pass; 100 percent coverage
  - [x] 31.2 Commit after the full gate passes, scoped `pass-service`. Do not push

- [x] 32. New Apple pass front (owner decision of 20 October, Requirement 9.12, design "Post-SP3 change: pass front layout")
  - [x] 32.1 Lay out the front as: header SESSION (the session code); primary BOARDING CLOSES (24-hour) and GATE (the venue, or "Venue not published"); secondary TITLE; auxiliary DATE (for example "Thu 3 Dec"), TIME (start to end, 24-hour, for example "13:00-14:00"), ROOM (the short room) and NOTICE (the disclaimer, which Requirement 9.2 keeps on the front)
    - The short room is the part after the first comma of the room (for example "Academy 409" from "Level 1, Academy 409"), or the whole room when it has one part; ROOM is left out when the room is empty. The back gains a ROOM line with the full room
    - Every time on the Apple pass, front and back, is 24-hour in the event timezone. The Google object and the calendar keep their formats
    - Why: the owner reviewed the live pass on 20 October and asked for the session code at the top right, the title near the top, and date, time and room in one row. Apple fixes the boarding pass row order (header, primary, secondary, auxiliary), so the title sits under the large row
    - Tests: the field keys, labels and order of every row; 24-hour times across midnight and in the event timezone; the short and full room, and no ROOM when empty; the disclaimer on front and back
  - [x] 32.2 Commit after the full gate passes, scoped `pass-service`; the owner redeploys dev and syncs the passes

- [x] 33. Take the Apple pass colours from the owner's artwork (owner decision of 20 October, design "Post-SP3 change: pass colours")
  - [x] 33.1 Set `backgroundColor` to `rgb(18, 8, 48)` (the deep indigo of the owner's picture), keep `foregroundColor` white, and set `labelColor` to `rgb(255, 176, 196)` (the pink of its glow line)
    - Why: the owner wanted their own picture as the pass background. Apple shows a background image only on event tickets, and the pass stays a boarding pass (Requirement 9.1), so the pass takes the picture's colours and the picture itself goes on the hand-off page (showcase-site task 20)
    - Contrast: white on the indigo is 19:1 and the pink labels 11:1 (WCAG AA needs 4.5:1)
    - Tests: the three colours, and a contrast check of foreground and label against the background
  - [x] 33.2 Commit after the full gate passes, scoped `pass-service`

- [x] 34. Owner's second pass review: no logo text, no front notice, purple and pink (owner decision of 20 October, design "Post-SP3 change: pass review 2", Requirement 9.2 amended)
  - [x] 34.1 Remove `logoText` ("Compass" was cut to "Comp..." between the logo and SESSION), so the top row is the logo and the session code
  - [x] 34.2 Remove the NOTICE field from the front. The disclaimer stays on the back, and `organizationName` "re:Invent Compass (unofficial)" and `description` "Unofficial boarding pass" still say unofficial; Requirement 9.2 is amended to the back only
  - [x] 34.3 Set `backgroundColor` to `rgb(140, 79, 255)` (#8C4FFF, Cyber Purple), keep `foregroundColor` white and set `labelColor` to `rgb(255, 0, 127)` (#FF007F, Electric Pink)
    - Wallet takes one solid background colour and one label colour, so the owner's ranges (#8C4FFF to #A020F0, #E0115F to #FF007F) become these two values
    - Accepted deviation (owner decision): the pink labels are 1.2:1 against the purple, under the WCAG 4.5:1 guideline, so the field labels are hard to read. The values (white, 4.49:1) carry the information. The contrast test now checks the values only and pins the label colour as an owner decision
  - [x] 34.4 Put the short room in the gate label, for example "GATE - OCTAVIUS 4" above "Caesars Palace", and drop ROOM from the bottom row, which keeps DATE and TIME. Wallet has no smaller line under a field value, so the owner chose the label over a right-aligned ROOM column. The full room stays on the back
  - [x] 34.5 Tests and commit after the full gate passes, scoped `pass-service`

- [x] 35. Owner's third pass review (owner decisions of 20 October, design "Post-SP3 change: pass review 3", Requirements 9.7, 9.10 and 9.12 amended)
  - [x] 35.1 GATE shows the short room (for example "Octavius 4"), or "Room not published"; the label is plain GATE again
  - [x] 35.2 Bottom row: DATE "Thu, 3 Dec 2026" (left), TIME "13:00-14:00 PST" with the event timezone abbreviation (centred) and VENUE with the venue or "Venue not published" (right-aligned), using the PassKit `textAlignment` key
    - Why PST: re:Invent runs on Las Vegas time; UTC would read eight hours off the venue clocks (owner chose PST)
  - [x] 35.3 Colours: background `rgb(35, 47, 63)` (#232F3F), values white, labels `rgb(161, 102, 255)` (#A166FF)
    - Accepted deviations (owner decisions): the background is one digit from AWS Squid Ink #232F3E (Requirement 9.10 note), and the labels are 3.78:1, under WCAG 4.5:1. White values are 13.6:1
  - [x] 35.4 Tests and commit after the full gate passes, scoped `pass-service`

- [x] 36. Owner's fourth pass review: one date and time field (owner decision of 20 October, design "Post-SP3 change: pass review 4", Requirement 9.12 amended)
  - [x] 36.1 The bottom row is DATE (left) with "3 Dec 2026 | 13:00-14:00" (no weekday, no zone abbreviation) and VENUE (right-aligned); the separate TIME field goes. The zone is still named once on the back (Requirement 9.6)
  - [x] 36.2 Remove the now unused zone abbreviation formatter; tests and commit after the full gate passes, scoped `pass-service`

- [x] 37. Owner's fifth pass review: airline wording (owner decision of 20 October, design "Post-SP3 change: pass review 5", Requirement 9.12 amended)
  - [x] 37.1 `logoText` is the session code (no heading), next to the logo where "Compass" was. Wallet has no colour key for the logo text, so it takes the value colour; the owner wanted purple, which only a purple foreground for every value would give
  - [x] 37.2 Header (top right): BOARDING CLOSES with the 24-hour time. Primary: TERMINAL (the venue, or "Venue not published") and GATE (the short room). Secondary: FLIGHT NAME (the title). Auxiliary: DATE "3 Dec 2026 | 13:00-14:00"
  - [x] 37.3 Tests and commit after the full gate passes, scoped `pass-service`

- [x] 38. Use the owner's logo and icon on the pass (owner decision of 20 October, design "Post-SP3 change: owner artwork")
  - [x] 38.1 `scripts/make-artwork.mjs` renders `site/public/artwork/logo.svg` into logo.png, logo@2x.png and logo@3x.png (160x50, 320x100, 480x150, the logo fitted to the height and left-aligned on a transparent canvas) and `site/public/artwork/favicon.svg` into icon.png, icon@2x.png and icon@3x.png (29, 58, 87, centred, transparent), with Playwright's Chromium (already a dev dependency), and writes `src/apple/artwork.ts`
  - [x] 38.2 Remove the drawn artwork (`src/artwork/draw.ts`, `src/artwork/png.ts`, `scripts/make-artwork.ts`) and its tests; `src/artwork/render.ts` keeps the file list and the module writer
  - [x] 38.3 Tests: the six images are PNGs of the documented sizes with transparent corners and visible ink, and the module header names the owner's SVGs; commit after the full gate passes, scoped `pass-service`

- [x] 39. Owner's sixth pass review (owner decision of 20 October, design "Post-SP3 change: pass review 6", Requirement 9.12 amended)
  - [x] 39.1 SESSION with the session code goes back to the header (top right); the logo text is removed, so the top row is the logo and SESSION
  - [x] 39.2 The bottom row is DATE (left) and BOARDING CLOSES (right-aligned, 24-hour)
  - [x] 39.3 Tests and commit after the full gate passes, scoped `pass-service`. Wallet draws the transit arrow (unchanged, `PKTransitTypeGeneric`) and picks every font size; a pass cannot set either

- [x] 40. Align the Google Wallet object with the final Apple layout (tracker GP1, design "Post-SP3 change: Google layout", Requirement 14.1 amended)
  - [x] 40.1 Text modules TERMINAL (venue, or "Venue not published"), GATE (the short room, or "Room not published"), DATE ("3 Dec 2026 | 13:00-14:00", 24-hour), BOARDING CLOSES (24-hour), ROOM (the full room, when there is one) and NOTICE (the disclaimer), reusing the Apple formatters and `shortRoom`; header the title (flight name), subheader the session code; background #232F3F. The Google class is unchanged
  - [x] 40.2 Tests and commit after the full gate passes, scoped `pass-service`
- [x] 41. Pass icon at 38 points (CTO review M3 of 20 October, design "Post-SP3 change: icon size")
  - [x] 41.1 `make-artwork.mjs` renders `icon.png`, `icon@2x.png` and `icon@3x.png` at 38, 76 and 114 pixels, the size in Apple's current Wallet Human Interface Guidelines (29 points was the older PassKit guide); regenerate `src/apple/artwork.ts`; the artwork test sizes and the comments follow. The logo stays up to 160 by 50 points
  - [x] 41.2 Tests and commit after the full gate passes, scoped `pass-service`
- [x] 42. Issue the Apple pass as a poster event ticket with the owner's picture (owner decision of 20 October, design "Post-SP3 change: poster event ticket", Requirements 9.1, 9.2, 9.10 and 9.12 amended, 9.13 added)
  - [x] 42.1 `buildPassJson` writes `eventTicket` instead of `boardingPass` (no `transitType`), with `preferredStyleSchemes` `["posterEventTicket", "eventTicket"]` and `semantics`: `eventType` `PKEventTypeGeneric`, `eventName` (the title), `venueName` (the venue, or "Venue not published"), `venueRegionName` "Las Vegas", `venueRoom` (the full room, or "Room not published"), `eventStartDate` and `eventEndDate` (canonical, built from `Date.parse`). The legacy fields keep the airline labels (header SESSION; primary TERMINAL and GATE; secondary FLIGHT NAME; auxiliary DATE and BOARDING CLOSES; the back unchanged), and `additionalInfoFields` carry BOARDING CLOSES and NOTICE so the poster layout still shows the seat release time and the disclaimer
  - [x] 42.2 `make-artwork.mjs` also renders the owner's picture `site/public/artwork/pass-background.jpg` into `artwork@2x.png` (716 by 896 pixels, 358 by 448 points, cover-cropped and centred) and the logo into `primaryLogo@2x.png` and `primaryLogo@3x.png` (up to 126 by 30 points, fitted to the height and left-aligned); regenerate `src/apple/artwork.ts`. Only the 2x artwork ships: with 3x a 10-pass bundle would pass Lambda's 6 MB response limit once base64-encoded, so the whole artwork set stays under 420 KB (10 passes are about 4.2 MB, 5.6 MB in base64)
  - [x] 42.3 Users read "Boarding Pass": `description` is "Unofficial Boarding Pass" and the calendar product name is "Boarding Passes"
  - [x] 42.4 Tests (pass.json style, schemes, semantics with and without venue and room, additional info fields, image names, sizes and the artwork budget, a signed pass carries the new files) and commit after the full gate passes, scoped `pass-service`. Owner check on the iPhone: delete the old dev passes, issue new ones and confirm the poster layout (iOS 26 or later) and the legacy fallback

- [x] 43. Show the room and the unblurred picture on iPhone: a poster generic pass with an event ticket fallback (owner decision of 21 October, design "Post-SP3 change: poster generic pass", Requirements 9.1 and 9.12 amended)
  - [x] 43.1 `buildPassJson` writes `posterGeneric` (header SESSION; primary FLIGHT NAME, TERMINAL, an arrow, GATE; footer DATE and BOARDING CLOSES; the back fields) and keeps `eventTicket` as the fallback (header SESSION; primary FLIGHT NAME; secondary TERMINAL and GATE; auxiliary DATE and BOARDING CLOSES; additional info and back as before). `preferredStyleSchemes` is dropped, because the poster event ticket needs NFC, which this pass cannot have. The semantics stay
  - [x] 43.2 Tests (both styles, field order, the arrow, no room and no venue, a signed bundle carries both styles and the artwork) and commit after the full gate passes, scoped `pass-service`. Owner check on iOS 27: remove the old dev pass, issue a new one, and confirm the picture is unblurred and the room shows as GATE

- [x] 44. Use the owner's Pass Designer event ticket (owner decision of 21 October, design "Post-SP3 change: Pass Designer event ticket", Requirements 9.1, 9.2, 9.10, 9.12 and 9.13 amended)
  - [x] 44.1 `buildPassJson` writes only `eventTicket`, in the layout, keys, labels, alignments, colours and back texts of the owner's design (`docs/previews/compass.pkpass`, read 21 October): header SESSION; primary FLIGHT NAME; secondary TERMINAL, the unlabelled arrow, GATE; auxiliary DATE and BOARDING CLOSES; back ABOUT, UNOFFICIAL PASS, BOARDING CLOSES, then ROOM, WALK FROM PREVIOUS, NEXT SESSION and NAME when known, then TIMES, IF YOUR PLANS CHANGE and PRIVACY. Organization name "AWS Community South Africa"; black, white and orange. The design's DISCLAIMER NOTICE field is dropped (ABOUT says it); the trailing spaces and the "Pacific TIme" sample are not copied; the times line stays generated. `posterGeneric` and the additional info fields go. The Google object background follows (#000000)
  - [x] 44.2 `make-artwork.mjs` renders `background@2x.png` (686 by 1006 pixels, 343 by 503 points) from `pass-background.jpg` instead of the poster artwork and primary logo, and keeps the icon and the logo at Apple's sizes (the design's 8423 by 3645 pixel logos and airline-only footer images are not used). The set is 395 KB, under the 420 KB budget
  - [x] 44.3 Tests (layout, alignments, the unlabelled arrow, the back order with and without per-pass data, colours and contrast, image sizes and budget, a signed pass keeps the design) and commit after the full gate passes, scoped `pass-service`. Owner check on the iPhone: remove the old dev pass, reissue, and compare with the Pass Designer preview
  - [x] 44.4 Owner check of 21 October: the layout matches the design, but the background was the older photo. The background is now the design's own gradient (`packages/pass-service/artwork/pass-background.png`, kept out of the site's public folder, taken from `docs/previews/compass.pkpass`) as `background.png` at 1x (343 by 503 pixels): at 2x the gradient weighs 538 KB, over the budget, and Wallet blurs an event ticket background, so 1x looks the same. The set is 222 KB

- [x] 45. Google Wallet publishing access outcome (tracker P05, decision date 28 October, build plan SP4 fallback and risk R4, ADR-010)
  - [x] 45.1 Record what Google's page asks for (a complete business profile and one class, both done) and how the owner reads the status in `docs/runbooks/google-wallet-setup.md` (22 October)
  - [x] 45.2 Record the outcome: approved on 21 October 2026 (Google's approval mail to the Admin account), confirmed by a read-only console check on 22 October (no Get publishing access box, business profile Approved, `compass-dev` Active, `compass-wallet` Developer). The "beta, test users" fallback is not needed: no code, infrastructure or wording change, `google_wallet_enabled` stays `true`, no test accounts. The owner's Android save on 22 October shows no "[TEST ONLY]" mark

- [ ] 46. Prod Google key, prod Google class and the Apple certificate check (tracker PK1, TAM M3 of 20 October, part of release gate G03)
  - [x] 46.1 Order the owner-run steps against `docs/runbooks/release.md` "First-time setup of an environment" and record them, with dates, in `docs/runbooks/google-wallet-setup.md` (22 October). Correct the `google-class.md` precondition: the service account needs no Cloud IAM role, only Developer access under Users in the Wallet console
  - [x] 46.2 Owner, any day before the deploy: confirm the Pass Type ID certificate expiry (14 November 2027) in the Apple developer portal and record the date it was checked (confirmed by the owner on 29 October 2026)
  - [ ] 46.3 Owner, on the prod deploy day after `scripts/release.sh prod` has created the secret containers: create a fresh `compass-wallet` JSON key, `scripts/load-secrets.sh prod google`, `scripts/check-secrets.sh prod`, `scripts/google-wallet-class.mjs --env prod` with the same key, then shred the key file. Record the results in the runbook

- [x] 47. Make the Google Wallet pass look like the Apple pass (owner decisions of 22 October, design "Post-SP3 change: Google template", Requirement 14.1 amended, infra tasks 24 and 25)
  - [x] 47.1 `make-artwork.mjs` also writes the Google images to `packages/pass-service/artwork/google/`: `wide-logo-v1.png` (the icon only, `favicon.svg`, 1280 by 400 pixels, fitted to the height, left-aligned, transparent) and `hero-v1.png` (the Pass Designer gradient, 1032 by 812 pixels, cover-cropped and centred, with the full logo `logo.svg` centred on it over a soft white glow). The version in the name gives a later artwork change a new URL, since Google caches images by URL
  - [x] 47.2 `buildGenericObject` sets `wideLogo` and `heroImage` (`sourceUri.uri` is `<PUBLIC_BASE_URL>/wallet/<file>`, each with a `contentDescription`), keeps `cardTitle`, `header` and `subheader`, sets `hexBackgroundColor` to #2035E2 (the blue at the top of the hero, so the card runs into the picture; white text measures about 7.9:1 on it), and writes the text modules TERMINAL, GATE, DATE and BOARDING CLOSES for the front rows, then ROOM (when known), ABOUT, UNOFFICIAL PASS, BOARDING CLOSES (the seat rule), WALK FROM PREVIOUS and NEXT SESSION (when known), TIMES, IF YOUR PLANS CHANGE and PRIVACY for the details, with the Apple back texts. No NAME (Google keeps the object on its servers) and no NOTICE (ABOUT and UNOFFICIAL PASS say it, as on the Apple back)
  - [x] 47.3 `scripts/google-wallet-class.mjs` sets `classTemplateInfo`: `cardTemplateOverride` with two `twoItems` rows (TERMINAL and GATE; DATE and BOARDING CLOSES) and `detailsTemplateOverride` listing the detail modules in order. The diff check compares nested values (a desired value matches when every key it names matches the class Google returns), so a second run still says "class: exists, left unchanged"
  - [x] 47.4 Tests (the image URLs and descriptions, the modules with and without room, walk and next, no name, the save JWT under 1800 characters, the class template naming only module ids the object writes, the nested diff check) and commit after the full gate passes, scoped `pass-service`
  - [x] 47.6 The owner's second dev run of the class script (24 October) printed "class: updated" again, so Google's copy of the class still differs from the template after a patch, and the script cannot say where because it never prints a response. `firstDifference` reports the first differing path and only the kind of value found there (missing, null, a list of n, a string), except a template `fieldPath`, which is layout data; the script prints "class: differs at <path> (found ...)" before it patches. Static tests. The owner's next run printed "class: differs at viewUnlockRequirement": Google returns its default `VIEW_UNLOCK_REQUIREMENT_UNSPECIFIED`, documented as the same as `UNLOCK_NOT_REQUIRED`, so the check treats the two as equal (`UNLOCK_REQUIRED_TO_VIEW` still patches) and names enum constants it finds. The run after that showed Google answers the setting in lowerCamelCase ("unlockNotRequired"), so enum values now compare without case or underscores. The owner's next run should print "class: exists, left unchanged"
  - [x] 47.7 Keep each object within Google's 10 text modules. The owner's dev sync of 24 October issued two passes but both Google inserts failed fast (`GoogleWalletFailure` 2, 338 ms): an object carried up to 13 text modules, and Google documents at most 10 from the object and 10 from the class (it would not display more either). The five texts that are the same on every pass (ABOUT, UNOFFICIAL PASS, the seat rule, IF YOUR PLANS CHANGE, PRIVACY) move to the class `textModulesData`, taken from a new import-free `src/apple/pass-texts.ts` that the Apple back also uses; the object keeps the front four plus ROOM, WALK FROM PREVIOUS, NEXT SESSION and TIMES (at most 8). The details template names `class.` or `object.` per item, in the same order. Tests hold the object and the class at 10 or fewer. Owner: release dev, run the class script again, then `forget_me` and sync, since a failed Google insert is not retried
  - [x] 47.8 Set the required `logo` next to the wide logo. A local diagnostic of 25 October (test objects built by `buildGenericObject`, set INACTIVE afterwards) showed Google refuses every object with `wideLogo` and no `logo`: HTTP 400 "logo must be set if wide_logo is set"; without the wide logo the same objects insert (200). `make-artwork.mjs` renders `logo-v1.png` (the icon on #2035E2, 660 by 660 pixels, 15 percent margin, which Google masks into a circle where the wide logo does not fit), the object sets `logo` with the wide logo and the hero, and `release.sh` ships it with the other two. Tests; confirm with the diagnostic before the release
  - [x] 47.5 Owner, after infra task 25 is deployed with `scripts/release.sh dev`: update the dev class with `scripts/google-wallet-class.mjs --env dev` (a fresh `compass-wallet` key; or on the prod deploy day with the task 46.3 key, before `--env prod`), reissue a pass, save it on Android and compare it with the Apple pass. Record the result in `docs/runbooks/google-class.md`

- [x] 48. Split the Google save link so every pass fits (final TAM review of 29 October, design "Final review: Google save links and insert retry")
  - [x] 48.1 One signed save JWT holding every pass passes Google's safe length of 1800 characters at about 9 passes (measured 29 October: 1 pass 746, 8 passes 1782, 9 passes 1930, 12 passes 2374). `GoogleWalletClient` gets a method that returns one or more save links, filling each link with as many objects as keep its JWT within `SAFE_JWT_LENGTH` (measured on the signed token, not estimated), in the hand-off order
  - [x] 48.2 The hand-off view returns `google: { saveUrl, saveUrls }`: `saveUrls` lists every link and `saveUrl` stays the first, so an older page still works. Update the contract schema in `packages/contracts/src/compass-api-schemas.ts`, the generated types and the Compass API OpenAPI document, and keep `GoogleSaveJwtOversize` counting any link that is still over (a single pass never is)
  - [x] 48.3 The board page (`site/src/lib/board/handoff-view.ts` and its component) shows one Save to Google Wallet button per link, labelled with the passes it holds when there is more than one; tests for 1, 8, 9 and 12 passes; the owner reviews the board page on the local preview before any push
  - [x] 48.4 Full gate, including `npm run test:site` and the e2e board tests; commit scoped `pass-service`

- [x] 49. Retry Google inserts that did not finish (final TAM review of 29 October, finding 5, same design section)
  - [x] 49.1 A pass whose Google insert failed or ran out of the insert budget keeps `googleState: 'none'` and so never gets a Google link. When a hand-off view is read, the service tries once more to insert such passes (the attendee asked for Google and Google is enabled), with the same concurrency limit and budget, marks each success `active`, and builds the links from the passes that are active; a failure is counted as `GoogleWalletFailure` and never stops the view
  - [x] 49.2 An insert that Google answers with 409 (the object already exists) counts as inserted, so a retry after a lost response is safe
  - [x] 49.3 Tests for the retry, the 409 case, the budget and the metrics; full gate; commit scoped `pass-service`

- [x] 50. Apple, Google and calendar for each session in a hand-off (owner decision of 29 October, design "Owner change: buttons for each session", supersedes the board part of task 48)
  - [x] 50.1 Contract (`contracts/compass-api.openapi.yaml`, then `npm run gen:copy` and `npm run gen:types`): each entry of the view's `sessions` gains `applePath` (or null), `googleSaveUrl` (or null) and `calendarPath` (or null). The top-level `google` goes back to `{ saveUrl }` and is present only when every Google pass fits in one link within `SAFE_JWT_LENGTH`; `saveUrls` is dropped. `apple.bundlePaths` and the top-level `calendarPath` stay as they are
  - [x] 50.2 Two new routes, each checked exactly like the bundle route (hand-off id pattern, hash lookup, expiry, the read limit, active passes only, the serial must be one of the hand-off's own): `GET /api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}` answers one signed `.pkpass` (`application/vnd.apple.pkpass`), and `GET /api/v1/handoffs/{handoffId}/calendar/{serialNumber}.ics` answers that session alone. A path is only given when the hand-off includes that platform and the pass has it; a serial that is not in the hand-off, not active or not valid is 404 with no detail. Wire both in `api-app.ts`, the handlers, the API Gateway OpenAPI in `infra/modules/api` and any route list or test that enumerates routes
  - [x] 50.3 Google per session: one save link per pass with an active object (one object per JWT, about 700 characters), signed in the view; the top-level link is built only when all of them fit in one; task 49's retry runs first, as now
  - [x] 50.4 The per hand-off read limit becomes 30 plus 3 for every pass in the hand-off (at most 80 passes), so every button on the page can be used once
  - [x] 50.6 Review fixes (security M1 and L1, QA Low-1, Low-2 and Info-1 of 30 October): mark a Google object active only while the pass is still active (a conditional write); when the pass was voided meanwhile, patch the object INACTIVE and do not report it as added; a failed insert is not retried on a view for 60 seconds; the top Google link is given only when every Google pass in the hand-off has its object and they fit one link, and is not attempted above 8 passes; every per-session button's accessible name starts with its visible text (for example "Add to Apple Wallet: ANT398")
  - [x] 50.5 Tests: routes (happy path, foreign serial, inactive pass, expired hand-off, platform not included, limit), view shape for 1, 8, 9 and 12 passes, Google top link present at 8 and absent when it would not fit, response schema tests; full gate; commit scoped `pass-service`

- [x] 51. Top buttons or session buttons, never both (owner decision of 30 October, design "Owner change: top or per session")
  - [x] 51.1 A hand-off of 8 sessions or fewer gets only the top actions: the Apple bundle, one Google link and the week's calendar, and every session's `applePath`, `googleSaveUrl` and `calendarPath` is null. When the one Google link cannot be made (a pass has no Google object, or the passes do not fit one link), the top `google` is null and the sessions that have a Google object get their own `googleSaveUrl` instead
  - [x] 51.2 A hand-off of more than 8 sessions gets per-session actions: `apple.bundlePaths` is empty and the top `google` is null, and every session has the paths and link it qualifies for. The week's calendar file stays at the top in both cases (owner, 30 October), so the top `calendarPath` is kept. The bundle route stays
  - [x] 51.3 One named threshold (8, the passes that fit one Google save link) replaces `MAX_TOP_LINK_PASSES`; update the site e2e fixtures so the 4 session hand-off has only top actions and the 24 session one only session actions; owner review on the local preview, then the full gate and e2e; commit scoped `pass-service`

- [x] 52. Drop the per-session calendar (owner decision of 30 October, design "Owner change: top or per session")
  - [x] 52.1 Remove `calendarPath` from each session in the hand-off view (contract source, generated copies, schemas, the API Gateway OpenAPI), the route `GET /api/v1/handoffs/{handoffId}/calendar/{serialNumber}.ics`, its handler, the harness route and their tests; the week calendar route stays
  - [x] 52.2 The per hand-off read limit becomes 30 plus 2 for every pass (one Apple pass and one view of the page per pass, with room to spare); full gate; commit scoped `pass-service`

- [x] 53. The venue of each session in the hand-off view (tracker L01, showcase-site task 40)
  - [x] 53.1 Each session in the hand-off view carries its `venue` (the official venue name the pass shows as GATE) or null, from the pass record; contract source, generated copies, schemas and tests; the site validator accepts only a known venue name or null
  - [x] 53.2 Full gate; commit on the L01 branch

- [x] 54. Six new high npm advisories (CI audit of 31 October 2026)
  - node-forge 1.4.0 to 1.4.2 (GHSA-7wch-p9px-956x, GHSA-jc66-7q78-782g, GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx, GHSA-5x38-2vff-x55p), a patch release that passkit-generator's `^1.4.0` range accepts
  - joi 17.13.4 to 17.13.9 through a root `overrides` entry (GHSA-4528-x5fx-h6hg), because passkit-generator 3.7.0 pins joi exactly; npm's own suggestion, downgrading passkit-generator to 3.1.2, is refused
  - `audit-check` passes with no new allowlist entry; full gate; commit scoped `pass-service`

- [x] 55. One wallet group for the week (owner request of 31 October, design "Owner change: one group for the week")
  - [x] 55.1 Apple: every pass carries the same top-level `groupingIdentifier` (a fixed constant for re:Invent 2026, no attendee data in it), so Wallet stacks all of an attendee's session passes as one group; check against Apple's PassKit package format reference that it applies to the `eventTicket` style with the same `passTypeIdentifier`; updated passes served by the pass web service carry it too, so passes already on a phone regroup on their next update
  - [x] 55.2 Google: every `GenericObject` the service inserts carries `groupingInfo` with the same `groupingId` constant and a `sortIndex` from the session start (whole minutes since the Unix epoch, which fits a 32-bit integer and puts earlier sessions first); check the field against the Google Wallet REST reference for `GenericObject`; the save token still names objects by id only, so its measured length does not change (assert it)
  - [x] 55.3 Tests for both at 100 percent coverage, including that the constant holds no attendee data and that two sessions sort by start; the contract and fixtures updated if they show pass JSON; full gate; commit scoped `pass-service`
  - [x] 55.4 Owner check on real phones from dev (confirmed by the owner on 1 November 2026): three or more sessions show as one stack in Apple Wallet and one group in Google Wallet, in start order

- [x] 56. Change alerts on the phone (owner choice of 31 October, option A of the lock-screen research, design "Owner change: change alerts")
  - [x] 56.1 Apple: the `terminal`, `gate`, `date` and `boardingCloses` fields carry a `changeMessage` with `%@` ("Terminal changed to %@", "Gate changed to %@", "Time changed to %@", "Boarding now closes at %@"), so when an update changes one of them, Wallet shows a notification on the lock screen; the other fields carry none
  - [x] 56.2 Google: when an update changes the session's venue, room, start or end, the service adds one message to the object with `messageType` `TEXT_AND_NOTIFY` through the generic object `addMessage` method, after the content patch: a header with the session code ("CMP340 changed"), a body that names only what changed with the new values in the pass's own formats, and an id unique to the pass version. Google allows 3 such notifications per pass in 24 hours: a refused or failed call is counted in the existing Google failure metric and never fails the update. An update that changes nothing the attendee sees sends no message
  - [x] 56.3 Tests at 100 percent coverage: each change message, no message when nothing visible changed, a quota refusal that leaves the update successful, and the message text holding no attendee data beyond the session's own fields; full gate; commit scoped `pass-service`
  - [x] 56.4 Owner check on dev (confirmed by the owner on 1 November 2026): MAM411 moved to a test room in the local catalog cache, `sync_passes` updated the pass, and both phones showed the change alert

## Notes

- There are no optional tasks. 100% coverage (Requirement 25.1) is part of S5's definition of done, so every test task is mandatory.
- Each task references specific granular requirements for traceability; every property test references its property number and the requirements it validates.
- Property-based tests use `fast-check` (at least 100 runs each) and are tagged `// Feature: pass-service, Property {n}: {title}`.
- **Requests for the integrator (dependencies).** S5 cannot edit `package.json` or `package-lock.json`. Please add to `packages/pass-service/package.json`, with exact pins: `zod` 4.6.7 (dependency; S5's own request, secret and response schemas; same pin as `packages/contracts`), needed before task 3; `node-forge` 1.4.0 (devDependency; Throwaway_PKI X.509 certificates, which `node:crypto` cannot create; already in the lockfile through `passkit-generator`), needed before task 12; `ical-generator` 11.1.2 (dependency; the hand-off calendar; same pin as `packages/core`), needed before task 17. Nothing else is assumed: APNs uses `node:http2`, the save JWT uses `node:crypto`, the zip uses `node:zlib`, and the YAML contract is read with a small test helper.
- **Requests for the integrator (decisions, see design Open Questions).** Confirm or overturn: 403 for the origin-verify refusal; the HMAC-derived Auth_Token; one-hour rate windows (plan 4.2 P13 and ADR-012 wording needs updating); update and void counted but never refused; plan 5.4 step 3 not built unless SP2 fails; the binary media types check in SP3; one save JWT per hand-off.
- **Alignment items for S6.** Bundle paths `packages/pass-service/dist/lambda/api.zip` and `passkit.zip`, handler `index.handler`; the environment variables, secret JSON keys, DynamoDB key schema (`pk`, `sk`, `gsi1pk`, `gsi1sk`, `gsi2pk`, `gsi2sk`, projection ALL, TTL attribute `ttl`), metric names (namespace `Compass`, dimension `Function`) and permissions in the design's Data Models; `scripts/load-secrets.sh` must write the PEM key names, not a raw `.p12`; the Google class suffix from `scripts/google-wallet-class.mjs` must match `GOOGLE_WALLET_CLASS_SUFFIX`.
- `packages/contracts/**` and `contracts/**` (S0) are read-only for this stream. If the contract must change, stop and ask the integrator.
- Never call a live service from tests. Spikes, deploys and real-device checks are run by the owner only.
- Commits use Conventional Commits scoped `pass-service`, with subject and body passed via multiple `-m` flags (no commit message file) and no `Co-Authored-By` or AI attribution, committed only after `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors. The first commit (task 1) includes `.kiro/specs/pass-service/`. Never push, merge, open a PR or tag (the integrator handles those). No em dashes or en dashes anywhere.
- Do each task yourself in this chat in numeric order; do not delegate to the spec-task-execution subagent and do not run tasks as parallel waves. Save files after each step.
- Checkpoints (tasks 7, 11, 15, 20, 29) validate incrementally; the final checkpoint confirms the definition of done for coverage, lint, format, typecheck and the build.
- Tasks 26, 27 and 28 wait on the owner's spike results. Until each arrives, the configuration defaults are the build plan's expected values and fallbacks, and the rest of the plan does not depend on them.

- **Security review amendments.** The review items (SR-H1 to SR-L5 in design.md, Requirement 27) are built inside the tasks they name; the tasks above are otherwise unchanged. Task 18.1 reads "delete first, then fan out", the counters in 9.1 include `forgetMe`, `updates`, `passUpdate` and the hand-off read counter, and 4.1 uses HKDF sub-keys with `tokenSalt`.

- **Requests for the integrator recorded while building (task 25.2).** No change was made outside `packages/pass-service/**` and this spec folder.
  - Dependencies: none beyond the declared ones. `zod`, `ical-generator`, `node-forge` (tests only) and the rest were declared by the integrator.
  - `.gitignore`: no change needed. The rules `secrets/` and `build/` matched the original folder names, so the folders were renamed to `src/credentials`, `test/credentials`, `src/bundling` and `test/bundling` (code review C1).
  - Build plan 4.1 and 4.2 and ADR-012 wording: SubHash and DeviceHash are HKDF-SHA256 sub-keys of the pepper (info `compass/sub/v1`, `compass/device/v1`); the Auth_Token is HMAC of the serial and a per-pass random `tokenSalt`; every record stores `pepperId`; there are new counters (`forgetMe`, `updates`, `passUpdate`, hand-off reads); forget_me keeps counters; at most 10 registrations per pass.
  - S6 alignment: secrets `compass/<env>/app` (`pepper`, `pepperId`) and `compass/<env>/origin-verify` (`originVerify`, optional `originVerifyPrevious`) named by `APP_SECRET_ID` and `ORIGIN_VERIFY_SECRET_ID` on both Lambdas; both roles read `app`, `origin-verify` and `apple-pass`, only `api` reads `google-wallet`; `PUBLIC_BASE_URL` is set in the second apply; the table keys, GSIs and `ttl` attribute in the README; `dynamodb:BatchWriteItem` for `api`; the passkit role limited with `dynamodb:LeadingKeys` to `DEV#*` for writes; the `api` timeout of 10 s is close to the forget_me fan-out budget (8 s), so 15 s is advised (or `APNS_BUDGET_MS=3000`).
  - Contract: no change requested. 403 for a missing or wrong origin-verify header is outside the contract on purpose. logMessages answers 200 for an unreadable body and registerDevice answers 401 for a bad body, because the contract lists no other status for them. The `x-api-key` header is enforced by API Gateway and never read by the Lambdas.
  - Binary media types: the three pass and calendar types are returned base64 with `isBase64Encoded: true`; SP3 step 8 still has to confirm it through the real edge (design Open Question 6).
  - Apple image sizes could not be checked against the live Wallet pages (they are script rendered); confirm on a device in SP3.

## Task Dependency Graph

Tasks run sequentially in numeric order. There are no parallel waves: every leaf task is placed in a single ordered wave so no task is started before the ones listed before it.

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": [
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "2.1",
        "2.2",
        "2.3",
        "2.4",
        "3.1",
        "3.2",
        "3.3",
        "3.4",
        "4.1",
        "4.2",
        "4.3",
        "5.1",
        "5.2",
        "5.3",
        "5.4",
        "6.1",
        "6.2",
        "6.3",
        "6.4",
        "6.5",
        "6.6",
        "8.1",
        "8.2",
        "8.3",
        "8.4",
        "8.5",
        "8.6",
        "9.1",
        "9.2",
        "9.3",
        "10.1",
        "10.2",
        "10.3",
        "10.4",
        "12.1",
        "12.2",
        "12.3",
        "12.4",
        "12.5",
        "12.6",
        "12.7",
        "13.1",
        "13.2",
        "13.3",
        "13.4",
        "13.5",
        "14.1",
        "14.2",
        "14.3",
        "14.4",
        "14.5",
        "14.6",
        "14.7",
        "16.1",
        "16.2",
        "16.3",
        "16.4",
        "16.5",
        "16.6",
        "16.7",
        "16.8",
        "16.9",
        "16.10",
        "17.1",
        "17.2",
        "17.3",
        "17.4",
        "17.5",
        "17.6",
        "17.7",
        "17.8",
        "18.1",
        "18.2",
        "18.3",
        "18.4",
        "19.1",
        "19.2",
        "19.3",
        "19.4",
        "19.5",
        "19.6",
        "19.7",
        "21.1",
        "21.2",
        "21.3",
        "21.4",
        "22.1",
        "22.2",
        "22.3",
        "22.4",
        "22.5",
        "22.6",
        "22.7",
        "22.8",
        "23.1",
        "23.2",
        "23.3",
        "23.4",
        "23.5",
        "24.1",
        "24.2",
        "24.3",
        "24.4",
        "24.5",
        "25.1",
        "25.2",
        "25.3",
        "26.1",
        "26.2",
        "27.1",
        "27.2",
        "28.1",
        "28.2",
        "30.1",
        "30.2"
      ]
    }
  ]
}
```
