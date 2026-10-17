data "aws_caller_identity" "current" {}

locals {
  region      = "us-east-1"
  account_id  = data.aws_caller_identity.current.account_id
  project_tag = "reinvent-compass"
  envs        = toset(["dev", "prod"])

  # Shared permissions boundary. Every role the apply phase creates must carry
  # it, and the environment roots compute the same ARN from this name.
  boundary_policy_name = "compass-permissions-boundary"
  boundary_policy_arn  = "arn:aws:iam::${local.account_id}:policy/${local.boundary_policy_name}"

  oidc_host     = "app.terraform.io"
  oidc_audience = "aws.workload.identity"

  workspaces = {
    dev  = var.hcp_workspaces.dev
    prod = var.hcp_workspaces.prod
  }

  # HCP Terraform subject claim. The run phase is part of the claim, so a plan
  # token can assume only the plan role and an apply token only the apply role.
  subject_claims = {
    for phase in ["plan", "apply"] : phase => {
      for e in local.envs :
      e => "organization:${var.hcp_organization}:project:${var.hcp_project}:workspace:${local.workspaces[e]}:run_phase:${phase}"
    }
  }

  # ---- shared policy fragments ------------------------------------------

  tag_on_create = {
    StringEquals = { "aws:RequestTag/project" = local.project_tag }
  }

  tag_on_manage = {
    StringEquals = { "aws:ResourceTag/project" = local.project_tag }
  }

  # Read-only actions for the plan phase and for refresh during apply. Only
  # describe, get and list actions: no data-plane reads (no s3:GetObject, no
  # dynamodb:GetItem, no log events). apigateway:GET is the API Gateway read.
  read_actions = [
    "apigateway:GET",
    "cloudfront:Describe*",
    "cloudfront:Get*",
    "cloudfront:List*",
    "cloudwatch:Describe*",
    "cloudwatch:Get*",
    "cloudwatch:List*",
    "budgets:Describe*",
    "budgets:View*",
    "dynamodb:Describe*",
    "dynamodb:List*",
    "iam:Get*",
    "iam:List*",
    "kms:Describe*",
    "kms:Get*",
    "kms:List*",
    "lambda:Get*",
    "lambda:List*",
    "logs:Describe*",
    "logs:List*",
    "s3:GetAccelerateConfiguration",
    "s3:GetBucket*",
    "s3:GetEncryptionConfiguration",
    "s3:GetLifecycleConfiguration",
    "s3:GetReplicationConfiguration",
    "s3:ListAllMyBuckets",
    "s3:ListBucket",
    "secretsmanager:Describe*",
    "secretsmanager:GetResourcePolicy",
    "secretsmanager:List*",
    "sns:Get*",
    "sns:List*",
    "tag:Get*",
    "wafv2:Describe*",
    "wafv2:Get*",
    "wafv2:List*",
  ]

  # No Terraform run reads a secret value: Terraform creates the containers only
  # and the owner loads the values. The deny is explicit so a later broadening of
  # the read list cannot expose the Apple, Google, pepper or origin-verify values.
  secret_value_deny = {
    for e in local.envs : e => {
      Sid      = "DenySecretValues"
      Effect   = "Deny"
      Action   = "secretsmanager:GetSecretValue"
      Resource = "*"
    }
  }
}
