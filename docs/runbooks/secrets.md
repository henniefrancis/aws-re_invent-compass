# Runbook: load the secrets

Owner-run, on your own machine, under your own AWS SSO session. Terraform creates the three secret containers and nothing more; it generates and stores no secret value.

**Never print, paste, log or commit a secret value.** Not in a terminal, a chat, a ticket, a screenshot or a file in the repository. The scripts below are written so no value is echoed, and they keep values only in a private temporary folder that is shredded on exit. Do not run them with `set -x` or under a screen recorder.

## Command

```
scripts/load-secrets.sh <dev|prod> edge-values --origin-verify-out <new file> --api-key-out <new file>
scripts/load-secrets.sh <dev|prod> app --origin-verify-file <file> [--rotate]
scripts/load-secrets.sh <dev|prod> apple --p12 <file> --wwdr <file> --pass-type-id <id> --team-id <id>
scripts/load-secrets.sh <dev|prod> google --service-account <file> --issuer-id <id>
```

## Preconditions

- `aws`, `jq` and `openssl` are installed. `edge-values` needs no AWS call.
- The environment has had its first apply (the containers exist) before you run `app`, `apple` or `google`.
- For `apple`: the Pass Type ID certificate exported as a `.p12`, and the Apple WWDR G4 certificate (DER `.cer` or PEM). The `.p12` password is read from the `COMPASS_P12_PASSWORD` environment variable or from a silent prompt. The Pass Type ID and the Team ID come from the Apple developer portal; they are account-specific and live only in the secret.
- For `google`: the downloaded service account key file and the numeric issuer id from the Google Pay and Wallet console.

## Steps

1. Before the first apply, run `edge-values`. It writes the origin-verify value and the API key to two new files (mode 600). Set the sensitive HCP workspace variables `origin_verify_value` and `api_key_value` from those files. Keep the origin-verify file for step 3.
2. Run `scripts/release.sh <env>` once so the containers exist (see `release.md`).
3. Run `app --origin-verify-file <the origin-verify file>`. It generates the pepper locally and writes `pepper` and `originVerify` into `compass/<env>/app`. It refuses to replace a secret that already holds a value unless you pass `--rotate`. Rotating the origin-verify value breaks the edge until the HCP variable and the secret agree again.
4. Run `apple`. The script converts the `.p12` to the PEM values the pass-service reads and writes `passTypeIdentifier`, `teamIdentifier`, `signerCertPem`, `signerKeyPem`, `signerKeyPassphrase` and `wwdrPem` into `compass/<env>/apple-pass`. The signing key is stored encrypted with a random passphrase that is kept in the same secret.
5. Run `google`. It writes `issuerId` and `serviceAccount` into `compass/<env>/google-wallet`.
6. Shred the two files from step 1 and any copy of the `.p12`, WWDR certificate and service account key that you no longer need (`shred -u <file>` where available). Clear your shell history of anything that held a value.

## Expected success outcome

Each run prints `wrote compass/<env>/<name>` (the secret name only) and exits 0. A failure exits non-zero with a message that names a file path or a secret name, never content.

## Checks that are safe

- `aws secretsmanager describe-secret --secret-id compass/<env>/app` shows metadata only.
- Never run `aws secretsmanager get-secret-value` for these secrets. The Terraform plan and apply roles are denied it too.
