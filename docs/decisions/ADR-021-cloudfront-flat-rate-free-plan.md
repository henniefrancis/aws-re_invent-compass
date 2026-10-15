# ADR-021 CloudFront flat-rate Free plan

Status: Proposed, 2026-10-15 (adopt only if the day-1 spike SP6 shows Terraform can manage the subscription).

## Context

WAF is most of the monthly cost (about USD 10.10 of about 12 to 13). CloudFront's flat-rate Free plan costs USD 0 and includes 1M requests and WAF with up to 5 rules. The golden rule forbids subscribing in the console: all infrastructure goes through Terraform.

## Decision

- Adopt the CloudFront flat-rate Free plan **only if** the subscription can be managed in Terraform, likely through the `awscc` provider for `AWS::PricingPlanManager::Subscription`.
- Spike SP6 checks this, plus whether the account is on the AWS Free Tier account plan (accounts on the Free Tier are not eligible).
- If SP6 fails, keep pay-as-you-go WAF (plan section 7.4).

## Consequences

- If adopted, the monthly cost drops by about the WAF share.
- If not, nothing changes; the cost stays at about USD 12 to 13 a month for prod.

## Source

- re:Invent Compass build plan sections 2 (A6), 6, 7.4, 10 (SP6), 13 (R14).
- [CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html), [AWS WAF pricing](https://aws.amazon.com/waf/pricing/).
