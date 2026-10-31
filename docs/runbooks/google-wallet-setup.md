# Status: Google Wallet setup (owner action O2, spike SP4)

Owner-run. This note records what was set up in the Google Pay and Wallet console and Google Cloud, and what SP4 still needs. No identifier or key is recorded here.

## Done (18 October 2026)

| Step                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issuer and business profile           | Reused the owner's existing issuer account, business profile **AWS Community South Africa** (complete, payments profile linked). The same issuer already serves another project of the owner. Issuer id: `<ISSUER_ID>` (kept by the owner, never committed).                                                                                                                                                                                                   |
| Google Wallet API and service account | Google Wallet API enabled in the owner's Google Cloud project. A Compass-only service account `compass-wallet@<project>.iam.gserviceaccount.com` was created, with no Cloud IAM role. Its JSON key is held in a private folder outside the repository, to be loaded by `scripts/load-secrets.sh <env> google` (see `secrets.md`) and then shredded.                                                                                                            |
| Link to the issuer                    | `compass-wallet` added under **Users** in the Wallet console with **Developer** access (not Admin). It is separate from the other project's service account, so it can be revoked on its own.                                                                                                                                                                                                                                                                  |
| Test user                             | None added: the owner's Android Wallet account is Admin on the issuer, which can already save Demo Mode passes.                                                                                                                                                                                                                                                                                                                                                |
| Generic class                         | `<ISSUER_ID>.compass-dev` created by the owner with `scripts/google-wallet-class.mjs --env dev` (`issuer: exists, left unchanged`, `class: created`). This ran before the first deploy, ahead of release runbook step 5, because publishing access needs at least one class; step 5 will report `class: exists, left unchanged`. The pass type stays Generic (owner decision, 18 Oct): the passes are not tickets, and an Event ticket class is one per event. |
| Publishing access                     | Requested on **18 October 2026** from **Google Wallet API**, **Get publishing access**. **Approved on 21 October 2026** (see "Publishing access" below). The issuer has left Demo Mode, so any Google Wallet user can save a pass and the "[TEST ONLY]" mark drops off.                                                                                                                                                                                        |

## Notes for the shared issuer

- Publishing access belongs to the issuer, so the approval covers both projects on it.
- A Developer service account can manage every class and object on the issuer. Compass uses its own account so a leaked Compass key can be revoked without touching the other project; the other project's passes are still reachable by it until then.

## What remains for SP4

1. First deploy of dev (`scripts/release.sh dev`), then `scripts/load-secrets.sh dev google --service-account <key file> --issuer-id <ISSUER_ID>`, then `scripts/check-secrets.sh dev`. Shred the key file afterwards.
2. On the Android phone: issue a pass, save it through the Save to Google Wallet link, check it shows no "[TEST ONLY]" mark (publishing access is granted), then void it and check it moves to Expired passes (`state: INACTIVE`).
3. Confirm the two open SP4 points in the pass-service design: an insert 409 is treated as "exists, patch instead", and a save JWT that lists `{id, classId}` stays under 1800 characters.
4. Create the prod class (`--env prod`) on the prod deploy day, with the prod key (see "Prod key and prod class" below).
5. Done: publishing access was approved on 21 October 2026, before the 28 October decision date, so the "beta, test users" fallback is not needed.

## Publishing access (tracker P05, pass-service task 45)

**Outcome: approved on Wednesday 21 October 2026.** Google's approval mail reached the Admin account that day ("AWS Community South Africa has been approved to access Passes in the Google Pay and Wallet Console"). It also asks issuers to use the "Add to Google Wallet" button, which the board page already does.

### What Google asks for

Google's page "Requesting publishing access" (last updated 21 October 2026, read 22 October) lists two prerequisites only: a complete business profile with a payments profile, and at least one class. Both were in place on 18 October; the request button only appears when they are. Screenshots are no longer required. Google reviews the issuer account and notifies the issuer when access is approved. The page gives no review time, so there is nothing more to send unless Google asks.

Google's "Pre-launch testing" page (same date) also lists checks Google may apply. The ones that touch Compass: the save link opens and saves the right pass in Chrome, Firefox and Safari; the Add to Google Wallet button follows the brand guidelines (the board page uses the official badge). Its check that "the JWT contains all valid domains" is about the JavaScript button: Compass uses a plain save link, so the JWT sends `origins: []` (`packages/pass-service/src/google/save-jwt.ts`). None needs a change now. If Google's reviewers ask about origins, the answer is the save link, not a button.

### Checking the status (owner)

1. Sign in to the Google Pay and Wallet console with the issuer's Admin account.
2. Open **Google Wallet API**. The **Get publishing access** box shows the state: in review, or publishing access granted (the box goes away or says so).
3. Check the Admin account's mailbox, including spam, for mail from the Google Wallet team. A request for more information comes by mail; answer it from that thread.
4. Record the date and the state in the table below.

| Date            | State seen in the console                   | By                                      |
| --------------- | ------------------------------------------- | --------------------------------------- |
| 18 October 2026 | Requested, in review                        | Owner                                   |
| 21 October 2026 | Approval mail from Google                   | Owner                                   |
| 22 October 2026 | Console check, see below                    | Claude in the owner's Chrome, read only |
| 22 October 2026 | Android save without the "[TEST ONLY]" mark | Owner                                   |

Console check on 22 October (nothing changed):

- **Google Wallet API:** no **Get publishing access** box any more, and no Demo Mode notice. Two classes, both Active: `compass-dev` (Generic, created 18 October) and the other project's Event Ticket class.
- **Business Profile:** Approved; organisation name and address verified.
- **Users:** the owner as Admin; `compass-wallet` and the other project's service account as Developer.
- **Notifications:** none.

### What the approval means

- The approval belongs to the issuer, so the dev class, the prod class (created later with the same issuer) and every pass object are covered. No class needs a separate review.
- Nothing changes in code, infrastructure or wording: `google_wallet_enabled` stays `true`, and the README, site and Builder Center post can say Google Wallet works for everyone.
- The fallback ("beta, test users", build plan SP4 fallback, risk R4, ADR-010) is not needed, and no test accounts are needed.

### End-to-end proof

On 22 October 2026 the owner saved a pass on the Android phone and confirmed it shows no "[TEST ONLY]" mark: the issuer is out of Demo Mode for real passes.

The console's Users page warns that the issuer has only one Admin. The owner decided on 22 October to leave it as it is.

## Prod key and prod class (tracker PK1, pass-service task 46)

Prod is not deployed yet (no prod `cloud.auto.tfbackend`). The prod secret `compass/prod/google-wallet` exists only after the first prod apply, so loading the key waits for `scripts/release.sh prod`. The class script needs only the key and the issuer id, not the prod infrastructure, but it runs on the same day so the key file exists only once and for a few minutes. The steps fit into `release.md` "First-time setup of an environment".

| When                                                             | Step (owner-run)                                                                                                                                                                                                                                                     | Status                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Any day before 29 October                                        | Apple certificate: in the Apple developer portal, **Certificates, Identifiers and Profiles**, **Certificates**, check that the Pass Type ID certificate expires on 14 November 2027. Record the date checked.                                                        | Open                   |
| Before the deploy day                                            | The rest of G03's prod preconditions (not PK1): prod `cloud.auto.tfbackend`, `load-secrets.sh prod edge-values`, `set-workspace-secrets.sh prod`. See `release.md` and `secrets.md`.                                                                                 | Open (G03)             |
| Deploy day, 29 or 30 October, after the Go/No-Go and the release | 1. `scripts/release.sh prod` (first apply; the health check fails by design until the secrets are loaded, `release.md` first-time step 7).                                                                                                                           | Waits on G01, G02, G03 |
| Deploy day                                                       | 2. Google Cloud console, **IAM and admin**, **Service accounts**, `compass-wallet`, **Keys**, **Add key**, **Create new key**, JSON. Save it outside the repository. The dev key stays: `compass/dev/google-wallet` still uses it.                                   | Waits on step 1        |
| Deploy day                                                       | 3. Load the prod secrets in `secrets.md` order: `origin-verify`, `app`, `apple` (export the `.p12` again from Keychain), then `scripts/load-secrets.sh prod google --service-account <key file> --issuer-id <ISSUER_ID>`. Expect `wrote compass/prod/google-wallet`. | Waits on step 2        |
| Deploy day                                                       | 4. `scripts/check-secrets.sh prod`: all seven present.                                                                                                                                                                                                               | Waits on step 3        |
| Deploy day                                                       | 5. `node scripts/google-wallet-class.mjs --service-account <key file> --issuer-id <ISSUER_ID> --env prod`. Expect `issuer: exists, left unchanged` and `class: created` (`<ISSUER_ID>.compass-prod`, which matches the Terraform default `compass-<env>`).           | Waits on step 2        |
| Deploy day                                                       | 6. `shred -u <key file>` and any `.p12` copy. Clear shell history of anything that held a value.                                                                                                                                                                     | Waits on steps 3 to 5  |
| Deploy day                                                       | 7. Carry on with `release.md` first-time steps 6 to 8 (health check HTTP 200, zero-diff plan). Then save a Google pass from the prod board page on the owner's Android phone.                                                                                        | Waits on step 6        |

After 1 November, when dev is torn down (`teardown.md`), delete the dev key under **Keys** for `compass-wallet` in the Google Cloud console.
