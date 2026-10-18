data "aws_caller_identity" "current" {}

locals {
  region      = "us-east-1"
  account_id  = data.aws_caller_identity.current.account_id
  project_tag = "reinvent-compass"
  envs        = toset(["dev", "prod"])

  # Permissions boundaries (owner review H1 and H2).
  #   - One boundary per environment caps the two Lambda roles of that
  #     environment: logs, that environment table and its indexes, and that
  #     environment secrets. The environment roots compute the same ARN.
  #   - One boundary caps the plan and apply roles themselves, so even a bug in
  #     their identity policies cannot reach IAM administration or secret values.
  boundary_policy_names = { for e in local.envs : e => "compass-${e}-boundary" }
  boundary_policy_arns  = { for e in local.envs : e => "arn:aws:iam::${local.account_id}:policy/compass-${e}-boundary" }
  hcp_boundary_name     = "compass-hcp-boundary"

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

  # Create actions need the project and the environment tag on the request;
  # later actions need both on the resource, so the dev role can never touch a
  # prod resource (M3). Used wherever the service supports the condition keys.
  tag_on_create = {
    for e in local.envs : e => {
      StringEquals = {
        "aws:RequestTag/project"     = local.project_tag
        "aws:RequestTag/environment" = e
      }
    }
  }

  tag_on_manage = {
    for e in local.envs : e => {
      StringEquals = {
        "aws:ResourceTag/project"     = local.project_tag
        "aws:ResourceTag/environment" = e
      }
    }
  }

  # Read-only actions for the plan phase and for refresh during apply. Describe,
  # get and list only, with no data-plane reads (no s3:GetObject, no
  # dynamodb:GetItem, no log events) and the specific IAM reads Terraform needs
  # instead of iam:Get* and iam:List* (M4). apigateway:GET is the API Gateway
  # read; it includes the API key read that the key resource refresh needs.
  read_actions = [
    "apigateway:GET",
    "cloudfront:Describe*",
    "cloudfront:Get*",
    "cloudfront:List*",
    "cloudwatch:Describe*",
    "cloudwatch:Get*",
    "cloudwatch:List*",
    "dynamodb:Describe*",
    "dynamodb:List*",
    "iam:GetRole",
    "iam:GetRolePolicy",
    "iam:ListAttachedRolePolicies",
    "iam:ListInstanceProfilesForRole",
    "iam:ListRolePolicies",
    "iam:ListRoleTags",
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
    Sid      = "DenySecretValues"
    Effect   = "Deny"
    Action   = "secretsmanager:GetSecretValue"
    Resource = "*"
  }

  # The two Lambda execution roles of each environment. These exact ARNs are the
  # only roles the apply phase may create, change or pass (H1).
  lambda_role_arns = {
    for e in local.envs : e => [
      "arn:aws:iam::${local.account_id}:role/compass-${e}-api-lambda",
      "arn:aws:iam::${local.account_id}:role/compass-${e}-passkit-lambda",
    ]
  }

  # Every IAM write action on the plan and apply roles and on the boundary and
  # HCP policies is denied outright, whatever any Allow says. The apply phase
  # therefore cannot widen, reattach or delete its own permissions (H1).
  hcp_role_arn_pattern = "arn:aws:iam::${local.account_id}:role/compass-*-hcp-*"
  hcp_policy_arn_patterns = [
    "arn:aws:iam::${local.account_id}:policy/compass-*-boundary",
    "arn:aws:iam::${local.account_id}:policy/compass-hcp-*",
    "arn:aws:iam::${local.account_id}:policy/compass-*-hcp-*",
  ]

  hcp_identity_deny = [
    {
      Sid    = "DenyIamWritesOnHcpRoles"
      Effect = "Deny"
      Action = [
        "iam:AttachRolePolicy",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:DeleteRolePermissionsBoundary",
        "iam:DeleteRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePermissionsBoundary",
        "iam:PutRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:UpdateRole",
        "iam:UpdateRoleDescription",
      ]
      Resource = local.hcp_role_arn_pattern
    },
    {
      Sid    = "DenyIamWritesOnBoundariesAndHcpPolicies"
      Effect = "Deny"
      Action = [
        "iam:CreatePolicyVersion",
        "iam:DeletePolicy",
        "iam:DeletePolicyVersion",
        "iam:SetDefaultPolicyVersion",
        "iam:TagPolicy",
        "iam:UntagPolicy",
      ]
      Resource = local.hcp_policy_arn_patterns
    },
    {
      Sid         = "DenyBoundaryChangesOutsideTheLambdaRoles"
      Effect      = "Deny"
      Action      = ["iam:PutRolePermissionsBoundary"]
      NotResource = flatten([for e in local.envs : local.lambda_role_arns[e]])
    },
    {
      Sid    = "DenyIdentityAndFederationAdministration"
      Effect = "Deny"
      Action = [
        "iam:CreateAccessKey",
        "iam:CreateLoginProfile",
        "iam:CreateOpenIDConnectProvider",
        "iam:CreateSAMLProvider",
        "iam:CreateUser",
        "iam:DeleteOpenIDConnectProvider",
        "iam:UpdateOpenIDConnectProviderThumbprint",
      ]
      Resource = "*"
    },
  ]
}
