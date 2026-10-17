# The dev and prod HCP Terraform workspaces and their non-sensitive variables are
# managed here with the tfe provider (golden rule: all infrastructure through
# Terraform). The bootstrap workspace itself is the one documented seed exception:
# it must exist before this configuration can run (design.md).
#
# Sensitive workspace variables (alarm_email, origin_verify_value, api_key_value)
# are never set here, because Terraform would keep them in state. The owner sets
# them from local files with scripts/set-workspace-secrets.sh through the HCP API.
#
# The provider reads its token from the TFE_TOKEN environment variable of the
# owner's shell.

data "tfe_project" "this" {
  name         = var.hcp_project
  organization = var.hcp_organization
}

resource "tfe_workspace" "env" {
  for_each = local.envs

  name         = local.workspaces[each.key]
  organization = var.hcp_organization
  project_id   = data.tfe_project.this.id
  description  = "Compass ${each.key} environment. Remote runs, CLI-driven."

  working_directory = "envs/${each.key}"

  # CLI-driven only: no VCS connection, no auto-apply, no speculative plans (so a
  # fork cannot start a plan), no queued runs on creation, no health assessments.
  auto_apply          = false
  speculative_enabled = false
  queue_all_runs      = false
  assessments_enabled = false
}

resource "tfe_workspace_settings" "env" {
  for_each = local.envs

  workspace_id   = tfe_workspace.env[each.key].id
  execution_mode = "remote"
}

# Dynamic provider credentials: the plan and apply roles are assumed through OIDC.
resource "tfe_variable" "aws_provider_auth" {
  for_each = local.envs

  workspace_id = tfe_workspace.env[each.key].id
  category     = "env"
  key          = "TFC_AWS_PROVIDER_AUTH"
  value        = "true"
  description  = "Use HCP dynamic provider credentials for AWS."
}

# The role ARNs embed the account id, so they are marked sensitive.
resource "tfe_variable" "plan_role_arn" {
  for_each = local.envs

  workspace_id = tfe_workspace.env[each.key].id
  category     = "env"
  key          = "TFC_AWS_PLAN_ROLE_ARN"
  sensitive    = true

  # Write-only, so the ARN (which embeds the account id) never enters state.
  # Bump value_wo_version to push a changed ARN.
  value_wo         = aws_iam_role.plan[each.key].arn
  value_wo_version = 1
  description      = "Role assumed in the plan phase."
}

resource "tfe_variable" "apply_role_arn" {
  for_each = local.envs

  workspace_id = tfe_workspace.env[each.key].id
  category     = "env"
  key          = "TFC_AWS_APPLY_ROLE_ARN"
  sensitive    = true

  # Write-only, so the ARN (which embeds the account id) never enters state.
  # Bump value_wo_version to push a changed ARN.
  value_wo         = aws_iam_role.apply[each.key].arn
  value_wo_version = 1
  description      = "Role assumed in the apply phase."
}

# Non-sensitive Terraform variables from the committed-shape input, for example
# event_timezone, event_window_start, event_window_end and id_token_issuer.
resource "tfe_variable" "terraform" {
  for_each = merge([
    for e in local.envs : {
      for k, v in var.workspace_variables[e] : "${e}/${k}" => { env = e, key = k, value = v }
    }
  ]...)

  workspace_id = tfe_workspace.env[each.value.env].id
  category     = "terraform"
  key          = each.value.key
  value        = each.value.value
  description  = "Managed by the bootstrap configuration."
}
