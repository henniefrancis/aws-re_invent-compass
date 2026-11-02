# Decisions: Infrastructure

_For architects: how the AWS infrastructure is deployed and protected, which resources may never be destroyed, and why the project runs a dev environment and its own domain._

Each section is one decision with four parts: the context, the decision, why, and the trade-off. Where a later decision or the code changed it, the section says so. The [Key decisions](Key-Decisions) page lists every decision on every theme.

## Terraform state and runs in HCP Terraform

**Context:** All infrastructure goes through [Terraform](Glossary#terraform), with no console changes. An Amazon S3 state bucket would have to exist before Terraform runs, so it would be created outside Terraform. The first plan also deployed from GitHub Actions through GitHub [OIDC](Glossary#oidc).

**Decision:**

- State lives in a personal [HCP Terraform](Glossary#hcp-terraform) organisation, with three workspaces in one project. Everything is in one AWS account, in `us-east-1`.
- The bootstrap workspace runs in Local execution mode: the owner runs it once, with his own credentials, and HCP only stores the state. It creates the OIDC provider for `app.terraform.io` (audience `aws.workload.identity`), the plan and apply roles for dev and prod, the account budget, the API Gateway account role, the domain and the two environment workspaces ([infra/bootstrap](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/bootstrap)).
- The dev and prod workspaces run remotely, driven from the command line, with HCP dynamic provider credentials: each run assumes the plan role or the apply role. No VCS connection, no auto-apply, no speculative plans, and no AWS access keys anywhere.
- The organisation and workspace names stay private, set through environment variables or a git-ignored backend file with a committed example.
- Terraform `>= 1.15, < 2.0`, AWS provider `~> 6.0`, and the workspaces pin Terraform `~> 1.15.0`.
- The owner runs [scripts/release.sh](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/release.sh): build, plan in HCP, refuse any plan that destroys or replaces a retained resource or adds an unexpected resource type, ask for a typed confirmation, apply, sync the site, invalidate the cache and check health. There is no deploy workflow.

**Why:** No state bucket to bootstrap, no long-lived keys, and only the owner can start a run.

**Trade-off:** Every deploy depends on the owner. Some setup is not in Terraform and lives in owner runbooks: the Apple Pass Type ID and certificate, the Google Wallet issuer and class, the npm trusted publisher and the GitHub settings.

**Today:** The release script asks for `yes` on dev, but on prod the operator must type `prod`, so a `yes` meant for dev cannot apply production. See [Release](Release).

## Retained resources

**Context:** Some resources cannot be replaced without harm. The public address is baked into every issued pass and into the npm package's default API URL. The table holds live device registrations. A deleted secret's recovery window blocks re-creating the same name.

**Decision:** These resources carry `prevent_destroy`, and the release script refuses any plan that destroys or replaces them:

| Resource                | Note                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CloudFront distribution | Issued passes stop updating; attendees run `forget_me`, then `issue_all_boarding_passes`.                                                                                                                                                                                                        |
| DynamoDB table          | Deletion protection is on as well. Point-in-time recovery is off, so `forget_me` is a real erasure; the data is short-lived and attendees can re-issue passes.                                                                                                                                   |
| The four secrets        | The Apple pass certificate, the Google Wallet key, the app pepper and the origin-verify value ([infra/modules/secrets/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/secrets/main.tf)). Restore inside the recovery window, then `terraform import`. |
| Site bucket             | Reproducible; retained only so a mistaken plan cannot take the site down.                                                                                                                                                                                                                        |

**Why:** A mistaken plan must never break issued passes or erase what attendees rely on.

**Trade-off:** Rollback never destroys these resources: it re-runs the release script with the previous commit's bundle (see [Rollback](Rollback)). Tearing down an environment needs deliberate steps, such as switching deletion protection off in a workspace variable first.

**Today:** The domain registration in the bootstrap also carries `prevent_destroy` (see [A custom domain for the site and the API](#a-custom-domain-for-the-site-and-the-api)).

## A dev environment before prod

**Context:** The pass service needs real-device checks on an iPhone and an Android phone and a live end-to-end run before release. Production must not be the first place the stack runs.

**Decision:** A dev workspace and [infra/envs/dev](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/envs/dev) deploy the same modules as prod, at `dev.reinvent-compass.vegas`. The order was: first dev deploy, then the pass service on dev with real-device checks, then integration with simulated and live end-to-end runs on dev, then the release gate, then prod. Dev is destroyed after submission.

**Why:** Real devices found real problems. The first iPhone run on dev showed that Safari's Add to Apple Wallet link received the pass bundle as base64 text, and the fix (the contract and the API module now treat `*/*` as a binary media type) was made before prod.

**Trade-off:** Dev roughly doubles the monthly cost while it exists.

**Later:** The submission target moved from 1 November to 4 November 2026 (see [Submit before the hackathon deadline](Decisions-Product-and-Scope#submit-before-the-hackathon-deadline)), so dev comes down after that. Prod has been live at https://reinvent-compass.vegas since 31 October 2026. See [Teardown](Teardown).

## CloudFront flat-rate Free plan

**Context:** WAF is most of the monthly cost. The CloudFront flat-rate Free plan costs nothing and includes WAF with up to 5 rules. Subscribing in the console would break the rule that all infrastructure goes through Terraform.

**Decision:** Not adopted (18 October 2026). The proposal was to adopt the plan only if the subscription could be managed in Terraform and the account was eligible. By then the web ACL needed 8 rules (three rate rules, three AWS managed rule groups, the kill switch and the body size rule), above the 5 the free plan includes. Pay-as-you-go WAF stays.

**Why:** Keeping every rule mattered more than the saving.

**Trade-off:** The project pays for WAF in each environment.

## A custom domain for the site and the API

**Context:** The edge was first planned on the CloudFront default address. That address is baked into every pass's update URL and into the npm package, and CloudFront's default certificate lets viewers use TLS 1.0.

**Decision:**

- `reinvent-compass.vegas` is registered with Route 53 Domains in the same AWS account by the bootstrap ([infra/bootstrap/domain.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/bootstrap/domain.tf)): one year at a time with auto-renew, the transfer lock, WHOIS privacy on every contact and `prevent_destroy`.
- Prod serves the site, `/board` and the API on the apex `reinvent-compass.vegas` only. Dev uses `dev.reinvent-compass.vegas`.
- The edge module requests an ACM certificate in `us-east-1`, validates it through DNS, sets the aliases with SNI only and `TLSv1.2_2021`, and adds Route 53 A and AAAA alias records.
- The public base URL is derived from the domain, which removes a two-apply step at first deploy.
- Passes use the apex: the update URL is `https://reinvent-compass.vegas/api/passkit`. A separate pass host was considered and dropped.
- The apply role may manage only tagged certificates and only its own environment's records in this one zone.

**Why:** A stable address the project owns, TLS 1.2 or later for viewers, and one address that is simple to run and explain.

**Trade-off:** The registration is paid yearly and the hosted zone costs a little each month. Changing the alias list replaces the certificate, so the alias set must be settled before passes are issued. The CloudFront default address still answers, and the release health check uses it.

## Related pages

- [Key decisions](Key-Decisions)
- [AWS architecture](AWS-Architecture)
- [Operations](Operations)
- [Release](Release)
- [Teardown](Teardown)
