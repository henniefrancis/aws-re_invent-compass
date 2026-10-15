# ADR-006 Toolchain

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

tech.md first proposed pnpm workspaces and Biome. The owner accepted a different toolchain in the architect interview (ADR-004 item 7), closer to Passembly. Up to six Kiro sessions build in parallel, so the toolchain and every dependency must be fixed on day 1.

## Decision

- **npm workspaces** with `package-lock.json`. This replaces pnpm.
- **ESLint plus Prettier.** This replaces Biome.
- **TypeScript 6**, strict.
- **vitest 4**, with 100% coverage thresholds.
- **Node 24.** Lambdas use `nodejs24.x` on arm64 (supported until 30 Apr 2028).
- **Angular 22**, zoneless and prerendered (`outputMode: "static"`), for the site only.
- **Playwright** for the site only.
- Libraries named in the plan: zod, `openapi-typescript`, `passkit-generator`, `aws-jwt-verify`.
- Exact version pins. S0 pre-installs every planned dependency.

## Consequences

- S0 updates tech.md and structure.md in the same change.
- CI runs `npm ci`, `prettier --check`, `eslint`, `tsc -b` and `vitest --coverage`.
- A stream that needs a new dependency asks the integrator, who owns the lockfile (ADR-007).

## Source

- re:Invent Compass build plan sections 3.4, 8 (S0, S7), 9.1, 11.1, 15.
- [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), [Lambda architectures](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html), [Angular SSR and prerender guide](https://angular.dev/guide/ssr).
