# Security policy

re:Invent Compass is an unofficial, open source community project. It is not affiliated with AWS.

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the impact you expect. You will get an acknowledgement within a few days. Please give a reasonable time to fix the problem before you share details publicly.

## Supported versions

Only the latest released version of the `reinvent-compass` package, the Kiro Power in `power/` and the deployed Compass API receive security fixes.

## Scope

In scope: the code in this repository, the Compass API it deploys, the Kiro Power and the npm package.

Out of scope: the AWS Events API, AWS Builder ID, Apple Wallet and Google Wallet themselves. Report problems in those services to their owners.

## How the project handles secrets

No secret, token, key, certificate or account identifier is ever committed. Server secrets live in AWS Secrets Manager and are loaded by the owner. Attendee tokens stay in the operating system keychain on the attendee's own machine. See `docs/architecture/build-plan.md` (threat model) and `docs/decisions/` for the full design.
