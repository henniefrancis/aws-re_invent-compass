_For architects: every architecture decision behind re:Invent Compass in one list, and where to read each one._

The project kept one numbered record for each architecture decision, from the kickoff on 15 October 2026 to the release. The wiki groups them by theme on six pages. Each section there gives the context, the decision, why it was taken and what it costs, checked against the code as it is today.

| Page                                                              | What it covers                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Decisions: Product and scope](Decisions-Product-and-Scope)       | What Compass does, for whom, by when, and on which devices                              |
| [Decisions: Architecture](Decisions-Architecture)                 | Contracts, the pass API, the hand-off, the edge, and how bookings stay behind the rules |
| [Decisions: Infrastructure](Decisions-Infrastructure)             | Terraform, environments, retained resources and the domain                              |
| [Decisions: Passes and wallets](Decisions-Passes-and-Wallets)     | Pass lifecycle, retention, confirmation and the board page buttons                      |
| [Decisions: Security and privacy](Decisions-Security-and-Privacy) | Personal data, secrets, the API key, accepted risks and GitHub access                   |
| [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling) | Branches, toolchain, CI, coverage and how the work was built                            |

## How to read the status

- **Amended** means a later decision, or a later change in the code, changed part of the decision. The section keeps the original decision and says under "Later" what changed and which section changed it.
- **Not adopted** means the decision was proposed but never put into effect. The section keeps the proposal for the record and says why it was dropped.
- Where the code now does something the original record did not say, the section says so under "Today".

The decision numbers below are the project's own record numbers. They appear only on this page.

## All decisions

| Number  | Title                                                      | Page                                                                                                            |
| ------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| ADR-001 | Terraform state in HCP Terraform                           | [Decisions: Infrastructure](Decisions-Infrastructure#terraform-state-and-runs-in-hcp-terraform)                 |
| ADR-002 | Branching model (amended)                                  | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#branching-model)                               |
| ADR-003 | Submission target (amended)                                | [Decisions: Product and scope](Decisions-Product-and-Scope#submit-before-the-hackathon-deadline)                |
| ADR-004 | Answers from the first architecture interview (amended)    | [Decisions: Product and scope](Decisions-Product-and-Scope#scope-answers-from-the-first-architecture-interview) |
| ADR-005 | Plan on a computer, board on any device                    | [Decisions: Product and scope](Decisions-Product-and-Scope#plan-on-a-computer-and-board-on-any-device)          |
| ADR-006 | Toolchain                                                  | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#toolchain)                                     |
| ADR-007 | Monorepo layout and file ownership                         | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#monorepo-layout-and-file-ownership)            |
| ADR-008 | One OpenAPI contract, copied byte for byte                 | [Decisions: Architecture](Decisions-Architecture#one-openapi-contract-copied-byte-for-byte)                     |
| ADR-009 | Attendee-only pass API                                     | [Decisions: Architecture](Decisions-Architecture#an-attendee-only-pass-api)                                     |
| ADR-010 | Pass lifecycle: update, void and expire (amended)          | [Decisions: Passes and wallets](Decisions-Passes-and-Wallets#update-void-and-expire-every-pass)                 |
| ADR-011 | Cloud hand-off to the phone                                | [Decisions: Architecture](Decisions-Architecture#cloud-hand-off-to-the-phone)                                   |
| ADR-012 | Personal data on the server                                | [Decisions: Security and privacy](Decisions-Security-and-Privacy#personal-data-on-the-server)                   |
| ADR-013 | CloudFront, WAF and API Gateway REST at the edge (amended) | [Decisions: Architecture](Decisions-Architecture#api-gateway-rest-behind-cloudfront)                            |
| ADR-014 | Terraform runs in HCP with dynamic credentials             | [Decisions: Infrastructure](Decisions-Infrastructure#terraform-state-and-runs-in-hcp-terraform)                 |
| ADR-015 | Retained resources                                         | [Decisions: Infrastructure](Decisions-Infrastructure#retained-resources)                                        |
| ADR-016 | Made-up sessions for tests and the demo                    | [Decisions: Product and scope](Decisions-Product-and-Scope#made-up-sessions-for-tests-and-the-public-demo)      |
| ADR-017 | Official awsevents server for reading only (amended)       | [Decisions: Architecture](Decisions-Architecture#all-bookings-go-through-the-compass-guardrail)                 |
| ADR-018 | CI pipeline (amended)                                      | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#one-required-ci-check)                         |
| ADR-019 | Google Wallet key in Secrets Manager                       | [Decisions: Security and privacy](Decisions-Security-and-Privacy#the-google-wallet-key-in-secrets-manager)      |
| ADR-020 | Dev environment before prod (amended)                      | [Decisions: Infrastructure](Decisions-Infrastructure#a-dev-environment-before-prod)                             |
| ADR-021 | CloudFront flat-rate Free plan (not adopted)               | [Decisions: Infrastructure](Decisions-Infrastructure#cloudfront-flat-rate-free-plan)                            |
| ADR-022 | Pass content kept until session end plus 24 hours          | [Decisions: Passes and wallets](Decisions-Passes-and-Wallets#pass-content-kept-until-session-end-plus-24-hours) |
| ADR-023 | Events API contract pinned in the repository               | [Decisions: Architecture](Decisions-Architecture#the-events-api-contract-pinned-in-the-repository)              |
| ADR-024 | Kiro hook input and blocking                               | [Decisions: Architecture](Decisions-Architecture#kiro-hooks-block-only-with-exit-2)                             |
| ADR-025 | Early contract lock                                        | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#early-contract-lock)                           |
| ADR-026 | Reviewed allowlist for npm audit                           | [Decisions: Security and privacy](Decisions-Security-and-Privacy#a-reviewed-allowlist-for-npm-audit)            |
| ADR-027 | Accepted residual risks (amended)                          | [Decisions: Security and privacy](Decisions-Security-and-Privacy#accepted-residual-risks)                       |
| ADR-028 | Site components covered by browser tests                   | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#site-components-covered-by-browser-tests)      |
| ADR-029 | Builders after the Kiro credits ran out (amended)          | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#builders-after-the-kiro-credits-ran-out)       |
| ADR-030 | API key enforced at API Gateway                            | [Decisions: Security and privacy](Decisions-Security-and-Privacy#api-key-enforced-at-api-gateway)               |
| ADR-031 | Custom domain for the site and the API                     | [Decisions: Infrastructure](Decisions-Infrastructure#a-custom-domain-for-the-site-and-the-api)                  |
| ADR-032 | MCP TypeScript SDK stays on v1 for 0.1.0 (amended)         | [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#mcp-typescript-sdk-stays-on-v1)                |
| ADR-033 | Read-only GitHub App for the tech scan                     | [Decisions: Security and privacy](Decisions-Security-and-Privacy#a-read-only-github-app-for-the-tech-scan)      |
| ADR-034 | One confirmation for issuing passes                        | [Decisions: Passes and wallets](Decisions-Passes-and-Wallets#one-confirmation-for-issuing-passes)               |
| ADR-035 | GitHub token handling                                      | [Decisions: Security and privacy](Decisions-Security-and-Privacy#github-token-handling)                         |
| ADR-036 | Board page buttons at the top or on each session           | [Decisions: Passes and wallets](Decisions-Passes-and-Wallets#board-page-buttons-at-the-top-or-on-each-session)  |
| ADR-037 | Walk from here on the board page                           | [Decisions: Product and scope](Decisions-Product-and-Scope#walk-from-here-on-the-board-page)                    |

Two records share one section because they describe one decision: the Terraform state record and the Terraform runs record both map to [Terraform state and runs in HCP Terraform](Decisions-Infrastructure#terraform-state-and-runs-in-hcp-terraform).

## Related pages

- [Architecture overview](Architecture-Overview)
- [AWS architecture](AWS-Architecture)
- [Security](Security)
- [How it was built](How-It-Was-Built)
