# Runbook: create the Google Wallet class

Owner-run. The Google Wallet issuer and class are not AWS infrastructure and are not managed by Terraform.

## What the class carries

Besides `viewUnlockRequirement`, the class now carries a template (`classTemplateInfo`, pass-service task 47), so the Google pass looks as close as Google allows to the Apple pass:

- Two front rows: TERMINAL and GATE, then DATE and BOARDING CLOSES.
- The details in order: ROOM, ABOUT, UNOFFICIAL PASS, BOARDING CLOSES (the seat rule), WALK FROM PREVIOUS, NEXT SESSION, TIMES, IF YOUR PLANS CHANGE, PRIVACY.

The template names text module ids (`packages/pass-service/src/google/google-layout.ts`, the same ids the api Lambda writes on each object). The objects carry the rest: the icon as the wide logo, the gradient with the full logo as the hero image (both served from `<PUBLIC_BASE_URL>/wallet/`), and the card colour #2035E2.

A class made before task 47 has no template. Run the script once per environment after a release that serves the images: it prints `class: updated`, and a second run prints `class: exists, left unchanged`. The template applies to every pass of the class at once. The images and the colour live on each object, so a pass issued before the release keeps the old ones until the api Lambda next patches it; reissue a pass to see the full new look.

## Command

```
node scripts/google-wallet-class.mjs --service-account <key file> --issuer-id <id> --env <dev|prod> [--suffix <suffix>]
```

The class id is `<issuer id>.<suffix>`. The suffix defaults to `compass-<env>`, or to the `GOOGLE_WALLET_CLASS_SUFFIX` environment variable when set. It must equal the Terraform variable `google_wallet_class_suffix` (default `compass-<env>`), which the api Lambda receives as `GOOGLE_WALLET_CLASS_SUFFIX`.

## Preconditions

- The Google Pay and Wallet console issuer account exists and you have its numeric issuer id.
- A service account with **Developer** access under **Users** in the Google Wallet console (it needs no Google Cloud IAM role), and its downloaded key file, held locally. The same key is loaded into `compass/<env>/google-wallet` by `scripts/load-secrets.sh` (see `secrets.md`).
- Node.js 24 or later. The script has no dependencies.

## Steps

1. Run the command above for `dev`.
2. Read the two lines it prints: one for the issuer and one for the class.
3. Save a pass on Android and compare it with the Apple pass (task 47.5). Record the date and the result here.
4. Repeat for `prod` after dev has been verified. The dev class was created on 18 October 2026. Prod runs on the prod deploy day with a fresh key, in the order set out in `google-wallet-setup.md` "Prod key and prod class".

## Expected success outcome

The script exits 0 and prints `issuer: exists, left unchanged` or `issuer: created`, then `class: created`, `class: updated` or `class: exists, left unchanged`. It is idempotent: running it again changes nothing. It prints no key, token or response body.

A Google API failure exits 1 with the step and the HTTP status. Bad arguments exit 2.

## If Google Wallet is cut

Set the Terraform variable `google_wallet_enabled` to `false` and release again. The class can stay in place.
