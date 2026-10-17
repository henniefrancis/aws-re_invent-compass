# Runbook: the WAF kill switch

Owner-run. The kill switch blocks every request to the CloudFront distribution (the site and the API) when you need to stop traffic at once, for example during abuse or a cost run-up.

The WAF web ACL always contains a rule named `kill-switch` at priority 5. Only its action changes: `count` when the switch is off, `block` when it is on. Nothing else is created or destroyed.

## Enable

1. Set the Terraform variable `kill_switch_enabled` to `true` in the HCP workspace for the environment (a workspace variable, or `kill_switch_enabled = true` in the git-ignored `infra/envs/<env>/terraform.tfvars` for a local plan).
2. Run `scripts/release.sh <env>` (see `release.md`). The plan should show one in-place change to the web ACL and no retained resource. Type `yes`.
3. The change reaches the edge within a few minutes. Every request then gets an HTTP 403 from WAF, so the release health check reports a failure after the apply. That is expected while the switch is on.

## Disable

1. Set `kill_switch_enabled` back to `false` (or remove the variable).
2. Run `scripts/release.sh <env>`. The plan shows one in-place change to the web ACL.
3. After propagation, `GET /api/v1/health` through CloudFront returns HTTP 200 and the health check passes.

## Notes

- Existing Apple passes keep working offline; they only stop updating while the switch is on.
- The per-IP rate rule, the PassKit rate rule and the AWS managed rule groups stay active whatever the switch says.
- WAF keeps no request samples and no logs by design, so there is no record of the blocked requests to review.
