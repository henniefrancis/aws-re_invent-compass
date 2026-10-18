# Plan roles, one per environment. Read-only: describe, get and list actions
# only, and no state permissions because HCP Terraform holds the state
# (Requirement 2.5). Each role carries the HCP permissions boundary.
#
# Workspace hygiene that IAM cannot express and the runbook requires: speculative
# plans from forks and VCS auto-apply stay disabled (the tfe workspaces below set
# that), and access to the workspace state is limited to the owner. API key values
# are readable through apigateway:GET because the key resource refresh needs it,
# so HCP state access is the control for them (see design.md).
locals {
  plan_policies = {
    for e in local.envs : e => jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "ReadOnly"
          Effect   = "Allow"
          Action   = local.read_actions
          Resource = "*"
        },
        local.secret_value_deny,
        {
          Sid      = "ReadDnsRecordsOfTheZone"
          Effect   = "Allow"
          Action   = ["route53:GetChange", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
          Resource = [local.zone_arn, "arn:aws:route53:::change/*"]
        },
      ]
    })
  }
}

resource "aws_iam_role" "plan" {
  for_each = local.envs

  name                 = "compass-${each.key}-hcp-plan"
  description          = "HCP Terraform plan phase for the ${each.key} environment. Read only."
  assume_role_policy   = local.trust_policies["plan"][each.key]
  permissions_boundary = aws_iam_policy.hcp_boundary.arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "plan" {
  for_each = local.envs

  name   = "compass-${each.key}-hcp-plan"
  role   = aws_iam_role.plan[each.key].id
  policy = local.plan_policies[each.key]
}
