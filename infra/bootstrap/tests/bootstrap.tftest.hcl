# Plan-only assertions for the bootstrap configuration (Requirements 2.2 to 2.8).
# The aws provider is mocked, so nothing here reaches AWS or HCP Terraform.
# The owner-only checks (a second apply shows no changes) are in the runbooks.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "example"
    }
  }

  mock_resource "aws_iam_openid_connect_provider" {
    defaults = {
      arn = "arn:aws:iam::aws:oidc-provider/app.terraform.io"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::aws:role/example"
    }
  }
}

variables {
  hcp_organization = "example-org"
  hcp_project      = "reinvent-compass"
  hcp_workspaces = {
    dev  = "example-dev"
    prod = "example-prod"
  }
}

run "one_oidc_provider_with_the_hcp_audience" {
  command = plan

  assert {
    condition     = aws_iam_openid_connect_provider.hcp_terraform.url == "https://app.terraform.io"
    error_message = "The OIDC provider must be app.terraform.io."
  }

  assert {
    condition     = aws_iam_openid_connect_provider.hcp_terraform.client_id_list == toset(["aws.workload.identity"])
    error_message = "The audience must be aws.workload.identity."
  }
}

run "four_roles_trust_their_own_workspace_and_phase" {
  command = plan

  assert {
    condition     = length(aws_iam_role.plan) == 2 && length(aws_iam_role.apply) == 2 && toset(keys(aws_iam_role.plan)) == toset(["dev", "prod"]) && toset(keys(aws_iam_role.apply)) == toset(["dev", "prod"])
    error_message = "There must be a plan role and an apply role for each of dev and prod."
  }

  assert {
    condition     = jsondecode(aws_iam_role.plan["dev"].assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:sub"] == "organization:example-org:project:reinvent-compass:workspace:example-dev:run_phase:plan"
    error_message = "The dev plan role must trust the dev workspace in the plan phase."
  }

  assert {
    condition     = jsondecode(aws_iam_role.plan["prod"].assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:sub"] == "organization:example-org:project:reinvent-compass:workspace:example-prod:run_phase:plan"
    error_message = "The prod plan role must trust the prod workspace in the plan phase."
  }

  assert {
    condition     = jsondecode(aws_iam_role.apply["dev"].assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:sub"] == "organization:example-org:project:reinvent-compass:workspace:example-dev:run_phase:apply"
    error_message = "The dev apply role must trust the dev workspace in the apply phase."
  }

  assert {
    condition     = jsondecode(aws_iam_role.apply["prod"].assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:sub"] == "organization:example-org:project:reinvent-compass:workspace:example-prod:run_phase:apply"
    error_message = "The prod apply role must trust the prod workspace in the apply phase."
  }

  assert {
    condition = alltrue([
      for r in concat(values(aws_iam_role.plan), values(aws_iam_role.apply)) :
      jsondecode(r.assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:aud"] == "aws.workload.identity" &&
      jsondecode(r.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
    ])
    error_message = "Every role must require the HCP audience and web identity federation."
  }
}

run "plan_role_is_read_only_and_cannot_read_apple_or_google_secrets" {
  command = plan

  assert {
    condition = alltrue([
      for a in jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action :
      can(regex("^[a-z0-9]+:(Describe|Get|List|View)", a)) || a == "apigateway:GET"
    ])
    error_message = "The plan role may only describe, get and list."
  }

  assert {
    condition     = !anytrue([for a in jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action : can(regex("(s3:GetObject|dynamodb:GetItem|terraform|states)", a))])
    error_message = "The plan role must have no data reads and no state permissions."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[1].Effect == "Deny" && jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[1].Action == "secretsmanager:GetSecretValue" && jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[1].Resource == "*"
    error_message = "The plan role must deny reading every secret value."
  }

  assert {
    condition     = !contains(jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action, "secretsmanager:Get*") && !contains(jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action, "secretsmanager:GetSecretValue")
    error_message = "The read list must not allow secret values."
  }
}

run "apply_role_scoping" {
  command = plan

  assert {
    condition     = length(aws_iam_policy.apply) == 8 && length(aws_iam_role_policy_attachment.apply) == 8
    error_message = "Each apply role must carry four area policies (eight in total)."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_policy.apply["dev-identity"].policy).Statement :
      contains(try(tolist(s.Action), [s.Action]), "iam:PassRole") &&
      toset(s.Resource) == toset(["arn:aws:iam::example:role/compass-dev-api-lambda", "arn:aws:iam::example:role/compass-dev-passkit-lambda"])
    ])
    error_message = "iam:PassRole must be limited to the two Lambda execution roles."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_policy.apply["dev-identity"].policy).Statement :
      contains(try(tolist(s.Action), [s.Action]), "iam:CreateRole") &&
      s.Condition.StringEquals["iam:PermissionsBoundary"] == "arn:aws:iam::example:policy/compass-permissions-boundary" &&
      s.Condition.StringEquals["aws:RequestTag/project"] == "reinvent-compass"
    ])
    error_message = "iam:CreateRole must require the project boundary and the project tag."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_policy.apply["prod-data"].policy).Statement :
      try(s.Condition.StringEquals["aws:RequestTag/project"], "") == "reinvent-compass" && contains(try(tolist(s.Action), [s.Action]), "dynamodb:CreateTable")
      ]) && anytrue([
      for s in jsondecode(aws_iam_policy.apply["prod-data"].policy).Statement :
      try(s.Condition.StringEquals["aws:ResourceTag/project"], "") == "reinvent-compass" && contains(try(tolist(s.Action), [s.Action]), "dynamodb:UpdateTable")
    ])
    error_message = "Create actions must require the request tag and later actions the resource tag."
  }

  assert {
    condition = alltrue([
      for k, p in aws_iam_policy.apply : length(p.policy) < 6144
    ])
    error_message = "Every apply managed policy must stay under the 6144 character limit."
  }

  assert {
    condition     = !anytrue([for s in jsondecode(aws_iam_policy.apply["dev-edge"].policy).Statement : s.Effect == "Allow" && contains(try(tolist(s.Action), [s.Action]), "*")])
    error_message = "No statement may allow every action."
  }

  assert {
    condition     = alltrue([for k, p in aws_iam_policy.apply : !strcontains(p.policy, "compass/prod") || startswith(k, "prod-")])
    error_message = "A dev policy must never reference prod resources."
  }
}

run "boundary_policy_and_account_role" {
  command = plan

  assert {
    condition     = aws_iam_policy.boundary.name == "compass-permissions-boundary"
    error_message = "The boundary policy name must match the one the environment roots compute."
  }

  assert {
    condition     = jsondecode(aws_iam_role.apigateway_cloudwatch.assume_role_policy).Statement[0].Principal.Service == "apigateway.amazonaws.com"
    error_message = "The account API Gateway role must be assumable by API Gateway."
  }

  assert {
    condition     = aws_api_gateway_account.this.cloudwatch_role_arn == aws_iam_role.apigateway_cloudwatch.arn
    error_message = "The account setting must use the API Gateway CloudWatch role."
  }
}

run "empty_organization_is_rejected" {
  command = plan

  variables {
    hcp_organization = ""
  }

  expect_failures = [var.hcp_organization]
}

run "identical_workspaces_are_rejected" {
  command = plan

  variables {
    hcp_workspaces = {
      dev  = "example-same"
      prod = "example-same"
    }
  }

  expect_failures = [var.hcp_workspaces]
}

# Static HCL scan for facts that plan output does not show.
run "source_scan" {
  command = plan

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_iam_openid_connect_provider\"", file("${path.module}/oidc.tf"))) == 1
    error_message = "Exactly one OIDC provider is required."
  }

  assert {
    condition     = !can(regex("aws_iam_access_key|aws_iam_user", join("\n", [for f in ["oidc.tf", "roles-plan.tf", "roles-apply.tf", "apigw-account.tf", "locals.tf"] : file("${path.module}/${f}")])))
    error_message = "No access key or IAM user may be created."
  }

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_api_gateway_account\"", file("${path.module}/apigw-account.tf"))) == 1
    error_message = "The account API Gateway setting must be created exactly once."
  }

  assert {
    condition     = can(regex("(?m)^[[:space:]]*cloud[[:space:]]*[{][[:space:]]*[}]", file("${path.module}/versions.tf")))
    error_message = "The bootstrap must use an empty cloud block that reads its names from the environment."
  }
}
