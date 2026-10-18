# Contributing

Thank you for your interest in re:Invent Compass. It is an unofficial community project for first-time AWS re:Invent attendees, and it is not affiliated with AWS.

## Before you start

- Read `README.md`, then the steering files in `.kiro/steering/` (product, tech, structure, workflow). They describe how the project is built.
- The project is spec driven. Each part has a Kiro spec in `.kiro/specs/<name>/` (requirements, design, tasks). Change the spec first when you change behaviour.
- Open an issue to discuss a larger change before you write code.

## Working on the code

```sh
npm ci
npx tsc -b
npm test                 # unit and property tests, with coverage
npm run test:site        # showcase site unit tests
npm run lint
npm run format:check
npm run check:dash
```

Everything runs offline in simulated mode (`COMPASS_MODE=simulated`). Tests never call the live AWS Events API, Apple, Google or AWS.

## Rules

- Keep coverage at 100% for statements, branches, functions and lines. Only the named exclusions in `vitest.config.ts` and ADR-028 are allowed.
- Use Conventional Commits, scoped by the spec name (for example `fix(events-client): ...`).
- Never commit a secret, token, key, certificate, account identifier or real personal data.
- No em dashes or en dashes anywhere; use hyphens, commas or colons. `npm run check:dash` enforces this.
- All infrastructure is Terraform. Do not add CloudFormation, CDK, SAM or console steps.

## Security

Please report security problems privately, as described in `SECURITY.md`.

## Licence

By contributing you agree that your contribution is licensed under the Apache License 2.0 (see `LICENSE`).
