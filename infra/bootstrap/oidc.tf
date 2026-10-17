# HCP Terraform as an OpenID Connect identity provider. HCP presents a signed
# token for each run phase and AWS exchanges it for short-lived credentials, so
# no access key exists anywhere. AWS validates the provider certificate chain
# itself, so no thumbprint is configured.
resource "aws_iam_openid_connect_provider" "hcp_terraform" {
  url            = "https://${local.oidc_host}"
  client_id_list = [local.oidc_audience]
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
          Principal = { Federated = aws_iam_openid_connect_provider.hcp_terraform.arn }
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
