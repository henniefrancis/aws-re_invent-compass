# Runbook: create the Google Wallet class

Owner-run. The Google Wallet issuer and class are not AWS infrastructure and are not managed by Terraform.

## Command

```
node scripts/google-wallet-class.mjs --service-account <key file> --issuer-id <id> --env <dev|prod> [--suffix <suffix>]
```

The class id is `<issuer id>.<suffix>`. The suffix defaults to `compass-<env>`, or to the `GOOGLE_WALLET_CLASS_SUFFIX` environment variable when set. It must equal the Terraform variable `google_wallet_class_suffix` (default `compass-<env>`), which the api Lambda receives as `GOOGLE_WALLET_CLASS_SUFFIX`.

## Preconditions

- The Google Pay and Wallet console issuer account exists and you have its numeric issuer id.
- A service account with the Wallet Objects issuer role, and its downloaded key file, held locally. The same key is loaded into `compass/<env>/google-wallet` by `scripts/load-secrets.sh` (see `secrets.md`).
- Node.js 24 or later. The script has no dependencies.

## Steps

1. Run the command above for `dev`.
2. Read the two lines it prints: one for the issuer and one for the class.
3. Repeat for `prod` after dev has been verified.

## Expected success outcome

The script exits 0 and prints `issuer: exists, left unchanged` or `issuer: created`, then `class: created`, `class: updated` or `class: exists, left unchanged`. It is idempotent: running it again changes nothing. It prints no key, token or response body.

A Google API failure exits 1 with the step and the HTTP status. Bad arguments exit 2.

## If Google Wallet is cut

Set the Terraform variable `google_wallet_enabled` to `false` and release again. The class can stay in place.
