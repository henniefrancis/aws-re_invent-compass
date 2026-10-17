# Plan roles, one per environment. Read-only: describe, get and list actions
# only, and no state permissions because HCP Terraform holds the state
# (Requirement 2.5).
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
        local.secret_value_deny[e],
      ]
    })
  }
}

resource "aws_iam_role" "plan" {
  for_each = local.envs

  name                 = "compass-${each.key}-hcp-plan"
  description          = "HCP Terraform plan phase for the ${each.key} environment. Read only."
  assume_role_policy   = local.trust_policies["plan"][each.key]
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "plan" {
  for_each = local.envs

  name   = "compass-${each.key}-hcp-plan"
  role   = aws_iam_role.plan[each.key].id
  policy = local.plan_policies[each.key]
}
