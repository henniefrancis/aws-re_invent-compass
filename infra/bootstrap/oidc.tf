# HCP Terraform as an OpenID Connect identity provider. HCP presents a signed
# token for each run phase and AWS exchanges it for short-lived credentials, so
# no access key exists anywhere. AWS validates the provider certificate chain
# itself, so no thumbprint is configured.
#
# AWS allows one provider per URL in an account. When another configuration
# already manages the app.terraform.io provider, create_oidc_provider = false
# reads it instead of creating a second one (which AWS would refuse). The read
# provider must list the same audience; Compass never changes or deletes it, so
# the configuration that owns it must keep it for as long as Compass runs.
resource "aws_iam_openid_connect_provider" "hcp_terraform" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = [local.oidc_audience]
}

data "aws_iam_openid_connect_provider" "hcp_terraform" {
  count = var.create_oidc_provider ? 0 : 1

  url = "https://${local.oidc_host}"

  lifecycle {
    postcondition {
      condition     = contains(self.client_id_list, local.oidc_audience)
      error_message = "The existing app.terraform.io OIDC provider must list the aws.workload.identity audience."
    }
  }
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.hcp_terraform[0].arn : data.aws_iam_openid_connect_provider.hcp_terraform[0].arn
}

# Trust policies. Each one conditions on the audience and on the exact subject
# claim of its own workspace and run phase (Requirement 2.4).
locals {
  trust_policies = {
    for phase in ["plan", "apply"] : phase => {
      for e in local.envs : e => jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect    = "Allow"
          Action    = "sts:AssumeRoleWithWebIdentity"
          Principal = { Federated = local.oidc_provider_arn }
          Condition = {
            StringEquals = {
              "${local.oidc_host}:aud" = local.oidc_audience
              "${local.oidc_host}:sub" = local.subject_claims[phase][e]
            }
          }
        }]
      })
    }
  }
}
