# Secrets

_For operators: which secrets Compass needs, how to load, rotate and check them without ever showing a value, and how to create the Google Wallet class._

Terraform creates the secret containers and nothing more: it generates no secret value and stores none. The owner loads every value from their own machine, under their own AWS SSO session, with three scripts in [scripts/](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/scripts). The HCP Terraform plan and apply roles are denied `secretsmanager:GetSecretValue`, so Terraform cannot read a value back either.

**Never print, paste, log or commit a secret value.** Not in a terminal, a chat, a ticket, a screenshot or a file in the repository. The scripts echo no value, pass values only through files in a private temporary folder (mode 700) that is shredded on every exit, and name only a file path, a variable key or a secret name in their errors. Do not run them with `set -x` or under a screen recorder.

## What is stored where

### Four secrets in Secrets Manager

Defined in [infra/modules/secrets/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/secrets/main.tf). All four are [retained resources](Rollback#retained-resources) with a 30-day recovery window. The key names match [secret-shapes.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/credentials/secret-shapes.ts), which the Lambdas validate on read.

| Secret                        | Keys                                                                                                      | Loaded with                     | Read by      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------ |
| `compass/<env>/app`           | `pepper`, `pepperId`                                                                                      | `load-secrets.sh app`           | api, passkit |
| `compass/<env>/origin-verify` | `originVerify`, optional `originVerifyPrevious`                                                           | `load-secrets.sh origin-verify` | api, passkit |
| `compass/<env>/apple-pass`    | `passTypeIdentifier`, `teamIdentifier`, `signerCertPem`, `signerKeyPem`, `signerKeyPassphrase`, `wwdrPem` | `load-secrets.sh apple`         | api, passkit |
| `compass/<env>/google-wallet` | `issuerId`, `serviceAccount`                                                                              | `load-secrets.sh google`        | api only     |

The pepper is the root of every owner hash (`subHash`) the pass service stores. The origin-verify value has its own secret so it can be rotated without touching the pepper.

### Three sensitive HCP workspace variables

| Variable              | What it is                                                                       |
| --------------------- | -------------------------------------------------------------------------------- |
| `origin_verify_value` | The `x-origin-verify` header value CloudFront sends to the API (32+ characters). |
| `api_key_value`       | The API key CloudFront sends in `x-api-key` (20 to 128 characters).              |
| `alarm_email`         | The address the alarm topic emails.                                              |

They are set straight into the workspace through the HCP API as sensitive variables, so they never appear in a committed file. `origin_verify_value` and the `origin-verify` secret must hold the same value: CloudFront sends the header and the Lambdas compare it.

## The commands

```
scripts/load-secrets.sh <dev|prod> edge-values --origin-verify-out <new file> --api-key-out <new file>
scripts/set-workspace-secrets.sh <dev|prod> [--origin-verify-file <file>] [--api-key-file <file>] [--alarm-email-file <file>]
scripts/load-secrets.sh <dev|prod> origin-verify --origin-verify-file <file> [--rotate [--keep-previous --previous-file <old file>]]
scripts/load-secrets.sh <dev|prod> app [--rotate-pepper --pepper-id pN]
scripts/load-secrets.sh <dev|prod> apple --p12 <file> --wwdr <file> --pass-type-id <id> --team-id <id>
scripts/load-secrets.sh <dev|prod> google --service-account <file> --issuer-id <id>
scripts/check-secrets.sh <dev|prod>
```

| Script                                                                                                                           | Subcommand      | What it does                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [load-secrets.sh](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/load-secrets.sh)                   | `edge-values`   | Makes no AWS call. Generates the origin-verify value and the API key with `openssl rand -hex 32` into two new files (mode 600). Refuses a path inside the repository or a file that already exists. |
|                                                                                                                                  | `origin-verify` | Writes `originVerify` from the file. Refuses to replace an existing value without `--rotate`. `--keep-previous --previous-file` also writes `originVerifyPrevious`.                                 |
|                                                                                                                                  | `app`           | Generates the pepper locally (32 random bytes, base64url) and writes it with `pepperId` `p1`. Replacing an existing pepper needs `--rotate-pepper --pepper-id pN` and the typed environment name.   |
|                                                                                                                                  | `apple`         | Converts the Pass Type ID `.p12` to PEM, stores the signing key encrypted with a random passphrase kept in the same secret, and adds the WWDR certificate (DER `.cer` or PEM).                      |
|                                                                                                                                  | `google`        | Checks the key file has `client_email` and `private_key`, then writes it with the issuer id.                                                                                                        |
| [set-workspace-secrets.sh](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/set-workspace-secrets.sh) |                 | Creates or updates the named sensitive variables in the environment's HCP workspace. Pass at least one of the three flags.                                                                          |
| [check-secrets.sh](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/check-secrets.sh)                 |                 | Reports `present` or `MISSING` for the three HCP variables and the four secrets. Exits 1 if anything is missing.                                                                                    |

Every `aws` call pins `--region us-east-1`. Before writing, `load-secrets.sh` checks for an existing value with `list-secret-version-ids` (the `AWSCURRENT` stage). If that check cannot reach AWS, it stops and writes nothing: the scripts fail closed.

## Preconditions

- `aws`, `jq` and `openssl` are installed (`edge-values` needs no AWS session).
- For `set-workspace-secrets.sh` and `check-secrets.sh`: `curl`, `jq`, the `TFE_TOKEN` environment variable (an HCP token that can write variables on the workspace) and `infra/envs/<env>/cloud.auto.tfbackend`. The token reaches `curl` on stdin and is never printed. `check-secrets.sh` also needs your AWS session.
- The environment has had its first apply, so the containers exist, before you run `origin-verify`, `app`, `apple` or `google`.
- For `apple`: the Pass Type ID certificate exported as a `.p12`, and the Apple WWDR intermediate certificate. The `.p12` password comes from the `COMPASS_P12_PASSWORD` environment variable or, when that is unset, from a silent prompt. The Pass Type ID and Team ID come from the Apple developer portal.
- For `google`: the service account key file and the numeric issuer id from the Google Pay and Wallet console.

## First load of an environment

1. **Before the first apply**, generate the edge values into two new files outside the repository:
   `scripts/load-secrets.sh <env> edge-values --origin-verify-out <file> --api-key-out <file>`
2. Put the alarm address in a file of its own, then set the three sensitive variables:
   `scripts/set-workspace-secrets.sh <env> --origin-verify-file <file> --api-key-file <file> --alarm-email-file <file>`
3. Run `scripts/release.sh <env>` once so the containers exist (see [Release](Release#first-time-setup-of-an-environment)).
4. `scripts/load-secrets.sh <env> origin-verify --origin-verify-file <the same origin-verify file>`
5. `scripts/load-secrets.sh <env> app`
6. `scripts/load-secrets.sh <env> apple --p12 <file> --wwdr <file> --pass-type-id <id> --team-id <id>`
7. `scripts/load-secrets.sh <env> google --service-account <key file> --issuer-id <id>`
8. `scripts/check-secrets.sh <env>`. All seven values must report present.
9. Create the [Google Wallet class](#google-wallet-class) while you still hold the key file.
10. Shred every file you no longer need: the edge value files, the alarm address file, any `.p12` copy, the WWDR file and the service account key (`shred -u <file>` where available). Clear your shell history of anything that held a value.

Each load prints `wrote compass/<env>/<name>` and each variable `set the sensitive variable <key>`, and exits 0.

`check-secrets.sh` cannot compare the HCP origin-verify value with the stored secret, because neither may be read back. A mismatch shows up as failing health checks after a release. The fix is to run `set-workspace-secrets.sh` and `load-secrets.sh ... origin-verify --rotate` again from the same file.

## Rotating the origin-verify value without an outage

The Lambdas accept either `originVerify` or `originVerifyPrevious` while both are set. The old value comes from the local file you used for the last load; the secret is never read back.

1. Generate a new value into a new file (`edge-values` writes a fresh pair; keep its origin-verify file and shred the API key file).
2. Write the secret with the previous value kept:
   `scripts/load-secrets.sh <env> origin-verify --origin-verify-file <new file> --rotate --keep-previous --previous-file <old file>`
3. Update the HCP variable from the new file with `scripts/set-workspace-secrets.sh <env> --origin-verify-file <new file>`, then run `scripts/release.sh <env>` so CloudFront sends the new value.
4. Wait about 10 minutes: for the distribution to deploy everywhere, for in-flight requests to drain, and for the Lambdas to refresh their cached secret (cached for 5 minutes by default).
5. Rewrite the secret without the previous value:
   `scripts/load-secrets.sh <env> origin-verify --origin-verify-file <new file> --rotate`
6. Shred both files.

Never run step 5 before step 3 and the wait: the edge would still send the old value and every request would be refused.

## Rotating the pepper

Avoid it. A new pepper changes every `subHash`, so every issued pass loses its owner match and every attendee must reissue (see [Rollback](Rollback#reissuing-passes)). If you must:

```
scripts/load-secrets.sh <env> app --rotate-pepper --pepper-id pN
```

`pN` is the next id (`p2`, then `p3`). The current id cannot be read back, so keep count. The script prints a warning and asks you to type the environment name.

## Renewing the Apple certificate

The Pass Type ID certificate expires yearly. Renew it in the Apple developer portal, export the new `.p12`, and run `scripts/load-secrets.sh <env> apple ...` again with it. The `apns-push-failures` alarm is the usual first sign of an expired certificate (see [Alarms](Alarms)).

## Google Wallet class

Google Wallet passes belong to a Generic class on the Google Wallet issuer. The issuer and the class are not AWS infrastructure, so Terraform does not manage them. [scripts/google-wallet-class.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/google-wallet-class.mjs) creates or updates both:

```
node scripts/google-wallet-class.mjs --service-account <key file> --issuer-id <id> --env <dev|prod> [--suffix <suffix>] [--issuer-name <name>]
```

- The class id is `<issuer id>.<suffix>`. The suffix comes from `--suffix`, else the `GOOGLE_WALLET_CLASS_SUFFIX` environment variable, else `compass-<env>`. `--env` defaults to `dev`.
- The suffix must equal the Terraform variable `google_wallet_class_suffix` (default `compass-<env>`), which the api Lambda receives as `GOOGLE_WALLET_CLASS_SUFFIX`.
- The class carries the texts that are the same on every pass (about, unofficial pass, the seat rule, if your plans change, privacy) and a template: two front rows (terminal and gate, then date and [boarding closes](Glossary#boarding-closes)) and the details in order. The layout comes from [google-layout.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/google/google-layout.ts).

**Preconditions.** A Google Pay and Wallet console issuer account and its numeric issuer id. A service account added under Users in the Wallet console with Developer access; it needs no Google Cloud IAM role. Its key file, held locally (the same key you load with `load-secrets.sh <env> google`). Node.js 24 or later. Google fetches the pass images during an insert, so the environment must already serve them under `/wallet/` (a release does this).

**Output.** It prints one line for the issuer (`issuer: exists, left unchanged` or `issuer: created`) and one for the class (`class: created`, `class: updated` or `class: exists, left unchanged`). When it updates a class it first prints `class: differs at <path> (found ...)`, naming where the class differed without printing Google's response. It is idempotent: a second run changes nothing. It prints no key, token or response body. It exits 0 on success, 1 on a Google API failure (naming the step and HTTP status) and 2 on bad arguments.

**When to run it.** Once per environment during [first-time setup](Release#first-time-setup-of-an-environment), and again after any change to the class layout. A template change applies to every pass of the class at once.

**If Google Wallet must stop**, set `google_wallet_enabled = false` and release (see [Alarms](Alarms#the-switches)). The class can stay in place.

**Keys.** Keep a service account key file only for as long as the load and the class script need it, then shred it. Delete a key in the Google Cloud console once the environment that uses it is gone.

## Checks that are safe

- `aws secretsmanager describe-secret --secret-id compass/<env>/app --region us-east-1` shows metadata only.
- `scripts/check-secrets.sh <env>` shows presence only.
- Never run `aws secretsmanager get-secret-value` for these secrets.

## Related pages

- [Release](Release)
- [Rollback](Rollback)
- [Security](Security)
- [Pass service](Pass-Service)
- [Passes and wallets decisions](Decisions-Passes-and-Wallets)
