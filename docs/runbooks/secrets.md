# Runbook: load the secrets

Owner-run, on your own machine, under your own AWS SSO session. Terraform creates the four secret containers and nothing more; it generates and stores no secret value.

**Never print, paste, log or commit a secret value.** Not in a terminal, a chat, a ticket, a screenshot or a file in the repository. The scripts below are written so no value is echoed, and they keep values only in a private temporary folder that is shredded on exit. Do not run them with `set -x` or under a screen recorder.

## The four secrets

| Secret                        | Keys                                                                                                      | Loaded by                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `compass/<env>/app`           | `pepper`                                                                                                  | `load-secrets.sh app`           |
| `compass/<env>/origin-verify` | `originVerify`                                                                                            | `load-secrets.sh origin-verify` |
| `compass/<env>/apple-pass`    | `passTypeIdentifier`, `teamIdentifier`, `signerCertPem`, `signerKeyPem`, `signerKeyPassphrase`, `wwdrPem` | `load-secrets.sh apple`         |
| `compass/<env>/google-wallet` | `issuerId`, `serviceAccount`                                                                              | `load-secrets.sh google`        |

The origin-verify value has its own secret so it can be rotated without touching the pepper. Replacing the pepper changes every `subHash`, so it needs a separate flag and a typed confirmation.

## Commands

```
scripts/load-secrets.sh <dev|prod> edge-values --origin-verify-out <new file> --api-key-out <new file>
scripts/set-workspace-secrets.sh <dev|prod> --origin-verify-file <file> --api-key-file <file> --alarm-email-file <file>
scripts/load-secrets.sh <dev|prod> origin-verify --origin-verify-file <file> [--rotate]
scripts/load-secrets.sh <dev|prod> app [--rotate-pepper]
scripts/load-secrets.sh <dev|prod> apple --p12 <file> --wwdr <file> --pass-type-id <id> --team-id <id>
scripts/load-secrets.sh <dev|prod> google --service-account <file> --issuer-id <id>
scripts/check-secrets.sh <dev|prod>
```

Every `aws` call in the scripts pins `--region us-east-1`.

## Preconditions

- `aws`, `jq` and `openssl` are installed. `edge-values` needs no AWS call. `set-workspace-secrets.sh` and `check-secrets.sh` also need `curl` and the `TFE_TOKEN` environment variable (an HCP token that can write variables on the workspace); the token goes to `curl` on stdin and is never printed.
- The environment has had its first apply (the containers exist) before you run `origin-verify`, `app`, `apple` or `google`.
- For `apple`: the Pass Type ID certificate exported as a `.p12`, and the Apple WWDR G4 certificate (DER `.cer` or PEM). The `.p12` password is read from the `COMPASS_P12_PASSWORD` environment variable or from a silent prompt. The Pass Type ID and the Team ID come from the Apple developer portal; they are account-specific and live only in the secret.
- For `google`: the downloaded service account key file and the numeric issuer id from the Google Pay and Wallet console.

## Steps

1. Before the first apply, run `edge-values` with two new file paths outside the repository (the script refuses a path inside it). It writes the origin-verify value and the API key (mode 600).
2. Set the sensitive HCP variables from those files with `set-workspace-secrets.sh`. It writes `origin_verify_value`, `api_key_value` and `alarm_email` straight into the workspace through the HCP API as sensitive variables; Terraform never holds them. Put the alarm address in a file of its own.
3. Run `scripts/release.sh <env>` once so the containers exist (see `release.md`).
4. Run `origin-verify --origin-verify-file <the origin-verify file>`. A secret that already holds a value is replaced only with `--rotate`, and rotating breaks the edge until the HCP variable and the secret agree again.
5. Run `app`. It generates the pepper locally and writes `pepper`. It refuses to replace an existing pepper unless you pass `--rotate-pepper`, prints a warning that every `subHash` changes and every attendee must reissue, and asks you to type the environment name.
6. Run `apple`. The script converts the `.p12` to the PEM values the pass-service reads. The signing key is stored encrypted with a random passphrase that is kept in the same secret.
7. Run `google`.
8. Run `check-secrets.sh <env>`. It reports present or MISSING for the three sensitive HCP variables and for the four secrets, and cannot compare the HCP origin-verify value with the stored one because neither may be read back.
9. Shred the generated files and any copy of the `.p12`, WWDR certificate and service account key you no longer need (`shred -u <file>` where available). Clear your shell history of anything that held a value.

If an existing-value check cannot reach AWS it stops with an error and writes nothing: the scripts fail closed.

## Expected success outcome

Each run prints `wrote compass/<env>/<name>` (the secret name only) or `set the sensitive variable <key>` and exits 0. A failure exits non-zero with a message that names a file path, a variable key or a secret name, never content.

## Checks that are safe

- `aws secretsmanager describe-secret --secret-id compass/<env>/app --region us-east-1` shows metadata only.
- Never run `aws secretsmanager get-secret-value` for these secrets. The Terraform plan and apply roles are denied it too.
