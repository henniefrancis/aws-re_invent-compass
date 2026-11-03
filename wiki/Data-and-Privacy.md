_For architects: every data item Compass holds, where it lives, how it is keyed, how long it lives and how it is deleted._

This page is the architect's view. For the attendee's view in plain words, see [Privacy](Privacy).

Compass keeps personal data in two places: the attendee's own computer, and one [DynamoDB](Glossary#dynamodb) table behind the [Compass API](Glossary#compass-api). The phone's wallet holds the passes the attendee adds. Nothing else stores personal data: the showcase site keeps no cookies or browser storage, CloudFront and WAF keep no logs, and the request logs carry no identifier.

## On the attendee's computer

Personal files live in a `reinvent-compass` folder under the platform's per-user data location: `%LOCALAPPDATA%` (falling back to `%APPDATA%`) on Windows, `~/Library/Application Support` on macOS, and `$XDG_DATA_HOME` or `~/.local/share` elsewhere. The folder is created with mode `0700` and files with mode `0600`, so only the owner can read them. The file adapter refuses symbolic links and writes atomically. On Windows the per-user location is relied on instead of POSIX modes. In [simulated mode](Glossary#simulated-mode) every file goes to a separate `simulated` subfolder.

| Data                            | Where                                                                       | Holds                                                                                                                                                                      | Lifetime                        | Deleted by                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Events API tokens               | OS keychain, service `reinvent-compass`, accounts `access`, `refresh`, `id` | Access, refresh and ID token, and the access token expiry                                                                                                                  | Until sign-out                  | `sign_out` (revokes the refresh token, then clears all three)                                                                  |
| GitHub tokens                   | OS keychain, accounts `github-access`, `github-refresh`                     | The read-only GitHub App user token and its refresh token                                                                                                                  | Until disconnect                | `disconnect_github`, `forget_me`                                                                                               |
| Catalog cache                   | `catalog-cache.<eventId>.json` (on Windows under `%APPDATA%`)               | The public session catalog                                                                                                                                                 | Treated as stale after 24 hours | Replaced on refresh. Holds no personal data.                                                                                   |
| Schedule snapshot               | `schedule-snapshot.json`                                                    | The last confirmed schedule and the event window, for the hooks                                                                                                            | Replaced on every fresh read    | `forget_me`                                                                                                                    |
| [Tech list](Glossary#tech-list) | `tech-profile.json`                                                         | AWS service and technology keys with counts, per project. A project is keyed by a SHA-256 of its folder or repository, so no path or name is stored. At most 500 projects. | Until removed                   | `forget_me`                                                                                                                    |
| Issued pass record              | `issued-pass-record.json` (with a backup and a lock file)                   | For each pass: serial number, session code, a hash of the pass fields and the platforms                                                                                    | Until removed                   | `forget_me`                                                                                                                    |
| Calendar and itinerary          | `output/reinvent.ics`, `output/itinerary.html`                              | The attendee's week                                                                                                                                                        | Until removed                   | `forget_me` removes the whole `output` folder                                                                                  |
| Week spec                       | `.kiro/specs/my-reinvent-week/` in the workspace                            | The planned week as a [Kiro spec](Glossary#kiro-spec)                                                                                                                      | The attendee's own file         | The attendee. Compass offers a `.gitignore` entry so it stays out of a public repository.                                      |
| QR page                         | A new `compass-qr-` folder in the OS temp folder, file mode `0600`          | The hand-off link as a QR code                                                                                                                                             | Until the hand-off expires      | Deleted at expiry, when replaced, on `forget_me` and when the server exits; a page left by a killed process is swept next time |
| Session state                   | Memory only                                                                 | The last scan result and pending safe swaps                                                                                                                                | The server process              | `forget_me` clears it; exit clears it                                                                                          |

When no OS keychain works, tokens are held in memory only and the attendee signs in again next session. Tokens are never written to a file.

## In the Compass API table

One table with keys `pk` and `sk` and one global secondary index, `GSI2`, which maps `SUB#<subHash>` to every item of an attendee. The key formats are in [keys.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/data/keys.ts) and the record types in [records.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/data/records.ts).

The only identity stored is the `subHash`: an HMAC-SHA256 of the Builder ID `sub`, keyed from a secret pepper. The ID token, the email and the raw `sub` are never stored. Each record also stores the `pepperId`, a short non-secret label of the pepper in use.

| Item                | `pk` / `sk`                                         | Holds                                                                                                                                                         | Expires                                                         |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Pass record         | `PASS#<serial>` / `PASS`                            | `subHash`, session code, the pass fields, platforms, the SHA-256 of the Apple authentication token and its salt, status, version, update stamps, Google state | Session end plus 24 hours                                       |
| Active marker       | `ACTIVE#<subHash>` / `<serial>`                     | Bookkeeping for the 80 active pass cap                                                                                                                        | Same as the pass                                                |
| Device registration | `DEV#<deviceHash>` / `REG#<serial>`                 | Hashed device id, pass type, the raw APNs push token (needed to push), `subHash`                                                                              | Same as the pass, extended when the pass is updated             |
| Registration copy   | `PASSREG#<serial>` / `<deviceHash>`                 | The same, keyed by pass, for the 10 devices per pass cap                                                                                                      | Same as the pass                                                |
| Hand-off            | `HANDOFF#<sha256(handoffId)>` / `HANDOFF`           | `subHash`, the serial numbers, what to include (Apple, Google, calendar)                                                                                      | 15 minutes after creation                                       |
| Rate counter        | `RATE#<subHash>` / `<kind>[:<scope>]#<windowStart>` | A count for one limit and window                                                                                                                              | The window end (a hand-off read counter: the hand-off's expiry) |

**The pass fields** are the minimum a pass shows: session code, title (up to 80 characters), venue, room, start and end, the walk from the previous session and the next [connection](Glossary#connection). The contract allows an optional attendee name; the current server never sends one. Free text is checked against an allowlist, so no URL or domain can reach a pass.

### TTL and expiry

Every item carries an `expiresAtMs` and a `ttl` attribute (whole seconds, rounded up). [DynamoDB TTL](Glossary#ttl) deletes expired items in the background, not at the exact second, so expiry is enforced in code: every read treats an item at or past its `expiresAtMs` as absent (`isLive` in [keys.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/data/keys.ts)). A rate counter's `ttl` is set 120 seconds after its window ends.

Point-in-time recovery is off, so no backup holds deleted data. See [why the pass content is kept for a day](Decisions-Passes-and-Wallets#pass-content-kept-until-session-end-plus-24-hours).

### Logs and metrics

| Source                            | What is kept                                                                                                                         | Retention          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Lambda request log                | One JSON line per request: request id, route template, status, latency, outcome, function name and metric counts                     | 14 days            |
| API Gateway access log            | Request id, route template, method, status, latencies, error type. Never the full path, a source address or an identifier.           | 14 days            |
| Custom metrics                    | Counts only, for example APNs failures, invalid push tokens, Google failures and PassKit log messages, with no identifying dimension | Not set by Compass |
| WAF and CloudFront                | No logging, request sampling off                                                                                                     | None               |
| PassKit log messages from devices | Counted, never stored                                                                                                                | None               |

## forget_me fan-out

`forget_me` deletes everything Compass holds about the attendee, on the server and then on the computer.

1. **The server** ([forget-me.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/handlers/api/forget-me.ts)) verifies the ID token, queries `GSI2` for `SUB#<subHash>` and batch-deletes every item it finds except rate counters, reading again until the index answers empty twice (at most three rounds). Rate counters are kept, so erasing cannot reset a limit; they expire with their window.
2. **Then the fan-out**, from the in-memory copies: an APNs push to every registered device of each live pass, and a Google Wallet patch to `INACTIVE`, within a time budget of twice the APNs budget. The erasure never waits for or fails because of the fan-out. Over the hourly `forget_me` limit the data is still erased, but the fan-out is skipped.
3. **The server answers 202** with the number of passes voided and items deleted.
4. **The computer** cleans up only after a 202, or a 404 or 410 that means the server holds nothing: the issued pass record and the `output` folder ([forget-me.ts in core](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/passes/forget-me.ts)), then the schedule snapshot, the tech list, the GitHub tokens, any QR page and the in-memory state ([forget_me tool](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/tools/forget-me.ts)). On any other answer nothing local is touched.

What `forget_me` cannot do: no wallet allows remote deletion. Passes already in Apple Wallet stay on the phone, voided, until the attendee removes them. Google objects become `INACTIVE`, and Google keeps its own copy. The Events API tokens stay until `sign_out`, and the public catalog cache stays.

## Related pages

- [Privacy](Privacy)
- [Security](Security)
- [Pass service](Pass-Service)
- [Decisions: Security and privacy](Decisions-Security-and-Privacy)
