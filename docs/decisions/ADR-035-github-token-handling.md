# ADR-035 GitHub token handling

Status: Accepted, 2026-10-29 (CTO final review finding 8; records requirement P2.9 and task 45).

## Context

Signing in to GitHub with the device flow gives Compass two tokens. The access token starts with `ghu_` and lasts 8 hours. The refresh token starts with `ghr_` and lasts 6 months (design, "GitHub, read-only"). A stolen token could read the repositories the App is installed on, so how Compass keeps and removes it matters. Requirement P2.9 sets the rules.

## Decision

- **Where it is kept.** `packages/core/src/github/token-store.ts` keeps each token in its own OS keychain entry through `@napi-rs/keyring`: service `reinvent-compass`, accounts `github-access` and `github-refresh`. On Linux the store is forced to `secret-service`, never the kernel keyutils store. The access entry holds `<expiry in ms>:<token>`.
- **Memory fallback.** If there is no keychain, or any keychain call throws, the store holds the tokens in process memory only and makes a best-effort delete of both entries. Nothing is written to a file.
- **Lifetime and refresh.**
  - `getAccessToken` refreshes when the access token has 60 seconds or fewer left, using the refresh token without a client secret (`grant_type=refresh_token`), and saves the new pair.
  - Two refreshes of the same refresh token share one call, so a rotation runs once.
  - A refresh that ends after disconnect, or after a new sign-in, does not save, so tokens cannot come back.
  - If GitHub rejects the refresh token, the store is cleared and the attendee must connect again. For any other refresh failure, the current token is used while it is still valid, and the error is thrown after that.
- **Where it is sent.** Only to `github.com` and `api.github.com`. The archive download does not send it on the redirect to `codeload.github.com`.
- **Redaction.** `registerGitHubSecrets` registers every token loaded or saved with the redacting logger, with its URL and form encodings. The one redactor, `packages/core/src/redact/redact.ts`, removes registered values from every log line and error. It also matches `Bearer` and `Authorization` values, `access_token` and `refresh_token` keys, and long opaque tokens. The placeholder is the fixed `[REDACTED]`. The tokens are removed from the logger when the store is cleared.
- **`disconnect_github`.** Stops any sign-in in progress and clears both tokens. The scanned tech list stays.
- **`forget_me`.** After the pass service confirms the passes are voided, it calls the same disconnect, which deletes both tokens, along with the Tech_Profile, the schedule snapshot and the QR page. If the pass service fails, nothing local is touched.
- **`sign_out`.** `sign_out` ends the AWS Builder ID session only. In `packages/mcp-server/src/tools/sign-out.ts` it does not clear the GitHub tokens. GitHub is a separate sign-in, removed by `disconnect_github` or `forget_me`.

## Consequences

- Compass cannot revoke the token on GitHub, because that needs the app's client secret. After disconnect or `forget_me`, the text tells the attendee to remove the install and the authorisation on GitHub (see ADR-033).
- Without a keychain, tokens last only as long as the server process, so the attendee signs in again after a restart.
- The keychain service name is shared with the Events store, with different account names.
- Not confirmed: whether leaving GitHub signed in after `sign_out` is the wanted behaviour. The code does it and the specs do not say. This is left to the owner.

## Source

- `packages/core/src/github/token-store.ts`, `packages/core/src/redact/redact.ts`, `packages/core/src/api/redacting-logger.ts`.
- `packages/mcp-server/src/adapters/github-adapter.ts` (disconnect), `packages/mcp-server/src/tools/github.ts`, `forget-me.ts`, `sign-out.ts`.
- `.kiro/specs/compass-power/requirements.md` P2.9, `design.md` ("GitHub, read-only (task 45)").
