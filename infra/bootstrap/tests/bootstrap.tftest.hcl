# Plan-only assertions for the bootstrap configuration (Requirements 2.2 to 2.8).
# The aws and tfe providers are mocked, so nothing here reaches AWS or HCP
# Terraform. The owner-only checks (a second apply shows no changes) are in the
# runbooks.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "aws"
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

  mock_resource "aws_iam_policy" {
    defaults = {
      arn = "arn:aws:iam::aws:policy/example"
    }
  }
}

mock_provider "tfe" {
  override_during = plan

  mock_data "tfe_project" {
    defaults = {
      id = "prj-example"
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
    condition = alltrue([
      for pair in [
        { role = aws_iam_role.plan["dev"], sub = "organization:example-org:project:reinvent-compass:workspace:example-dev:run_phase:plan" },
        { role = aws_iam_role.plan["prod"], sub = "organization:example-org:project:reinvent-compass:workspace:example-prod:run_phase:plan" },
        { role = aws_iam_role.apply["dev"], sub = "organization:example-org:project:reinvent-compass:workspace:example-dev:run_phase:apply" },
        { role = aws_iam_role.apply["prod"], sub = "organization:example-org:project:reinvent-compass:workspace:example-prod:run_phase:apply" },
      ] : jsondecode(pair.role.assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:sub"] == pair.sub
    ])
    error_message = "Each role must trust its own workspace and run phase."
  }

  assert {
    condition = alltrue([
      for r in concat(values(aws_iam_role.plan), values(aws_iam_role.apply)) :
      jsondecode(r.assume_role_policy).Statement[0].Condition.StringEquals["app.terraform.io:aud"] == "aws.workload.identity" &&
      jsondecode(r.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
    ])
    error_message = "Every role must require the HCP audience and web identity federation."
  }

  assert {
    condition = alltrue([
      for r in concat(values(aws_iam_role.plan), values(aws_iam_role.apply)) :
      r.permissions_boundary == aws_iam_policy.hcp_boundary.arn
    ])
    error_message = "The plan and apply roles must carry the HCP permissions boundary."
  }
}

run "plan_role_is_read_only_and_cannot_read_secret_values" {
  command = plan

  assert {
    condition = alltrue([
      for a in jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action :
      can(regex("^[a-z0-9]+:(Describe|Get|List|View)", a)) || a == "apigateway:GET"
    ])
    error_message = "The plan role may only describe, get and list."
  }

  assert {
    condition     = !anytrue([for a in jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action : can(regex("(s3:GetObject|dynamodb:GetItem|terraform|states|iam:Get[*]|iam:List[*]|secretsmanager:Get[*]|GetSecretValue)", a))])
    error_message = "No data reads, no state permissions and no broad iam or secret reads."
  }

  assert {
    condition     = contains(jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action, "iam:GetRole") && contains(jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[0].Action, "iam:GetRolePolicy")
    error_message = "The plan role needs the specific IAM role reads."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[1].Effect == "Deny" && jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[1].Action == "secretsmanager:GetSecretValue" && jsondecode(aws_iam_role_policy.plan["dev"].policy).Statement[1].Resource == "*"
    error_message = "The plan role must deny reading every secret value."
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
      toset(s.Resource) == toset(["arn:aws:iam::aws:role/compass-dev-api-lambda", "arn:aws:iam::aws:role/compass-dev-passkit-lambda"])
    ])
    error_message = "iam:PassRole must be limited to the two Lambda execution roles."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_policy.apply["dev-identity"].policy).Statement :
      s.Effect == "Allow" && contains(try(tolist(s.Action), [s.Action]), "iam:CreateRole") &&
      toset(s.Resource) == toset(["arn:aws:iam::aws:role/compass-dev-api-lambda", "arn:aws:iam::aws:role/compass-dev-passkit-lambda"]) &&
      s.Condition.StringEquals["iam:PermissionsBoundary"] == "arn:aws:iam::aws:policy/compass-dev-boundary" &&
      s.Condition.StringEquals["aws:RequestTag/project"] == "reinvent-compass" &&
      s.Condition.StringEquals["aws:RequestTag/environment"] == "dev"
    ])
    error_message = "iam:CreateRole must name the two exact Lambda roles and require the per-environment boundary and both tags."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_policy.apply["prod-data"].policy).Statement :
      try(s.Condition.StringEquals["aws:RequestTag/project"], "") == "reinvent-compass" && try(s.Condition.StringEquals["aws:RequestTag/environment"], "") == "prod" && contains(try(tolist(s.Action), [s.Action]), "dynamodb:CreateTable")
      ]) && anytrue([
      for s in jsondecode(aws_iam_policy.apply["prod-data"].policy).Statement :
      try(s.Condition.StringEquals["aws:ResourceTag/project"], "") == "reinvent-compass" && try(s.Condition.StringEquals["aws:ResourceTag/environment"], "") == "prod" && contains(try(tolist(s.Action), [s.Action]), "dynamodb:UpdateTable")
    ])
    error_message = "Create actions must require both request tags and later actions both resource tags, for the role's own environment."
  }

  assert {
    condition = alltrue([
      for k, p in aws_iam_policy.apply : length(p.policy) < 6144
    ])
    error_message = "Every apply managed policy must stay under the 6144 character limit."
  }

  assert {
    condition = alltrue([
      for k, p in aws_iam_policy.apply : !anytrue([
        for s in jsondecode(p.policy).Statement :
        s.Effect == "Allow" && contains(try(tolist(s.Action), [s.Action]), "*")
      ])
    ])
    error_message = "No statement may allow every action."
  }

  assert {
    condition     = alltrue([for k, p in aws_iam_policy.apply : !strcontains(p.policy, "compass/prod") || startswith(k, "prod-")]) && alltrue([for k, p in aws_iam_policy.apply : !strcontains(p.policy, "compass/dev") || startswith(k, "dev-")])
    error_message = "A policy must never reference the other environment."
  }

  assert {
    condition     = alltrue([for k, p in aws_iam_policy.apply : !strcontains(p.policy, "PutSecretValue") && !strcontains(p.policy, "iam:Get*") && !strcontains(p.policy, "iam:List*")])
    error_message = "The apply role must not write secret values or hold broad iam reads."
  }
}

# H1: no Allow in any apply policy can match the apply or plan role ARNs. An Allow
# on an IAM write action (anything but Get and List) must name exact resources with no wildcard, and none of them
# may be an hcp role; and every other Allow must not name an hcp role at all.
run "no_apply_allow_can_reach_the_hcp_roles" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for k, p in aws_iam_policy.apply : [
        for s in jsondecode(p.policy).Statement :
        s.Effect != "Allow" ||
        !anytrue([for a in try(tolist(s.Action), [s.Action]) : startswith(a, "iam:") && !startswith(a, "iam:Get") && !startswith(a, "iam:List")]) ||
        alltrue([for r in try(tolist(s.Resource), [s.Resource]) : !strcontains(r, "*") && !strcontains(r, "-hcp-")])
      ]
    ]))
    error_message = "An Allow on an IAM action must name exact resources, none of them an hcp role."
  }

  assert {
    condition = alltrue(flatten([
      for k, p in aws_iam_policy.apply : [
        for s in jsondecode(p.policy).Statement :
        s.Effect != "Allow" || alltrue([for r in try(tolist(s.Resource), [s.Resource]) : !strcontains(r, "-hcp-")])
      ]
    ]))
    error_message = "No Allow may name an hcp role or policy."
  }

  assert {
    condition = alltrue([
      for e in ["dev", "prod"] :
      anytrue([
        for s in jsondecode(aws_iam_policy.apply["${e}-identity"].policy).Statement :
        s.Effect == "Deny" && s.Sid == "DenyIamWritesOnHcpRoles" && s.Resource == "arn:aws:iam::aws:role/compass-*-hcp-*" && contains(s.Action, "iam:AttachRolePolicy") && contains(s.Action, "iam:PutRolePolicy") && contains(s.Action, "iam:UpdateAssumeRolePolicy")
      ])
    ])
    error_message = "The identity policies must deny every IAM write on the hcp roles."
  }

  assert {
    condition = alltrue([
      for e in ["dev", "prod"] :
      anytrue([
        for s in jsondecode(aws_iam_policy.apply["${e}-identity"].policy).Statement :
        s.Effect == "Deny" && s.Sid == "DenyBoundaryChangesOutsideTheLambdaRoles" && length(s.NotResource) == 4
      ])
    ])
    error_message = "A boundary change must be denied on every role except the Lambda roles."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_policy.hcp_boundary.policy).Statement :
      s.Effect == "Deny" && s.Sid == "DenyIamWritesOnHcpRoles"
      ]) && anytrue([
      for s in jsondecode(aws_iam_policy.hcp_boundary.policy).Statement :
      s.Effect == "Deny" && s.Sid == "DenySecretValues"
    ])
    error_message = "The HCP boundary must repeat the IAM write and secret value denies."
  }
}

# N1: API Gateway tagging is scoped to the tag paths of REST APIs, API keys and
# usage plans, requires the environment resource tag, and the PUT may only set the
# role's own environment, so a dev role cannot retag a prod resource.
run "api_gateway_tagging_is_scoped_to_the_environment" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for k, p in aws_iam_policy.apply : [
        for s in jsondecode(p.policy).Statement :
        s.Effect != "Allow" || !anytrue([for r in try(tolist(s.Resource), [s.Resource]) : endswith(r, "::/tags/*")])
      ]
    ]))
    error_message = "No Allow may cover the whole /tags/* path."
  }

  assert {
    condition = alltrue([
      for e in ["dev", "prod"] : anytrue([
        for s in jsondecode(aws_iam_policy.apply["${e}-edge"].policy).Statement :
        s.Effect == "Allow" && s.Sid == "TagManagedApiGatewayResources" &&
        contains(try(tolist(s.Action), [s.Action]), "apigateway:PUT") &&
        s.Condition.StringEquals["aws:ResourceTag/environment"] == e &&
        s.Condition.StringEquals["aws:RequestTag/environment"] == e &&
        s.Condition.StringEquals["aws:ResourceTag/project"] == "reinvent-compass" &&
        length(s.Resource) == 3 &&
        alltrue([for r in s.Resource : strcontains(r, "/tags/arn%3Aaws%3Aapigateway%3Aus-east-1%3A%3A%2F")])
      ])
    ])
    error_message = "Tagging must name the encoded tag ARN paths and require the environment on the resource and on the request."
  }

  assert {
    condition = alltrue([
      for e in ["dev", "prod"] : anytrue([
        for s in jsondecode(aws_iam_policy.apply["${e}-edge"].policy).Statement :
        s.Effect == "Allow" && s.Sid == "UntagManagedApiGatewayResources" &&
        contains(try(tolist(s.Action), [s.Action]), "apigateway:DELETE") &&
        s.Condition.StringEquals["aws:ResourceTag/environment"] == e
      ])
    ])
    error_message = "Untagging must require the environment resource tag."
  }
}

run "lambda_boundaries_are_per_environment" {
  command = plan

  assert {
    condition     = aws_iam_policy.boundary["dev"].name == "compass-dev-boundary" && aws_iam_policy.boundary["prod"].name == "compass-prod-boundary"
    error_message = "Each environment needs its own boundary policy, named as the environment roots compute."
  }

  assert {
    condition     = !strcontains(aws_iam_policy.boundary["dev"].policy, "prod") && !strcontains(aws_iam_policy.boundary["prod"].policy, "dev")
    error_message = "A boundary must not reference the other environment."
  }

  assert {
    condition     = strcontains(aws_iam_policy.boundary["dev"].policy, "table/compass-dev") && strcontains(aws_iam_policy.boundary["dev"].policy, "secret:compass/dev/*") && !strcontains(aws_iam_policy.boundary["dev"].policy, "compass-*") && !strcontains(aws_iam_policy.boundary["dev"].policy, "compass/*")
    error_message = "The dev boundary must name only the dev table and the dev secrets."
  }
}

run "account_api_gateway_role_and_workspaces" {
  command = plan

  assert {
    condition     = jsondecode(aws_iam_role.apigateway_cloudwatch.assume_role_policy).Statement[0].Principal.Service == "apigateway.amazonaws.com"
    error_message = "The account API Gateway role must be assumable by API Gateway."
  }

  assert {
    condition     = jsondecode(aws_iam_role.apigateway_cloudwatch.assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "aws" && startswith(jsondecode(aws_iam_role.apigateway_cloudwatch.assume_role_policy).Statement[0].Condition.ArnLike["aws:SourceArn"], "arn:aws:apigateway:us-east-1::/restapis/")
    error_message = "The API Gateway role trust must carry aws:SourceAccount and aws:SourceArn."
  }

  assert {
    condition     = aws_api_gateway_account.this.cloudwatch_role_arn == aws_iam_role.apigateway_cloudwatch.arn
    error_message = "The account setting must use the API Gateway CloudWatch role."
  }

  assert {
    condition = alltrue([
      for w in values(tfe_workspace.env) :
      w.auto_apply == false && w.speculative_enabled == false && w.queue_all_runs == false
    ])
    error_message = "The workspaces must stay CLI-driven: no auto-apply, no speculative plans, no queued runs."
  }

  assert {
    condition     = alltrue([for s in values(tfe_workspace_settings.env) : s.execution_mode == "remote" && s.global_remote_state == false])
    error_message = "The environment workspaces run remotely and share no state."
  }

  assert {
    condition     = alltrue([for v in values(tfe_variable.plan_role_arn) : v.sensitive]) && alltrue([for v in values(tfe_variable.apply_role_arn) : v.sensitive])
    error_message = "The role ARN variables must be sensitive."
  }
}

run "workspace_variables_are_created_from_the_input" {
  command = plan

  variables {
    workspace_variables = {
      dev  = { event_timezone = "America/Los_Angeles" }
      prod = {}
    }
  }

  assert {
    condition     = length(tfe_variable.terraform) == 1 && tfe_variable.terraform["dev/event_timezone"].category == "terraform"
    error_message = "A non-sensitive variable must be created for the workspace."
  }
}

run "sensitive_workspace_variables_are_refused" {
  command = plan

  variables {
    workspace_variables = {
      dev  = { api_key_value = "x" }
      prod = {}
    }
  }

  expect_failures = [var.workspace_variables]
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

  assert {
    condition     = !can(regex("(?m)^[^#]*role/compass-[$][{]e[}]-[*]", file("${path.module}/roles-apply.tf")))
    error_message = "No apply role statement may name the compass-<env>-* role pattern."
  }

  assert {
    condition     = !can(regex("(?m)^[^#]*(sensitive_value|value[[:space:]]*=[[:space:]]*var[.]alarm_email|origin_verify_value|api_key_value)", file("${path.module}/workspaces.tf")))
    error_message = "The workspaces file must not set a sensitive variable."
  }
}
