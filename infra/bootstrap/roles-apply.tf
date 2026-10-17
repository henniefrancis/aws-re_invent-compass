# Apply roles, one per environment, and the permissions boundary they impose.
#
# Scoping (Requirement 2.6):
#   - create actions require aws:RequestTag/project, later actions require
#     aws:ResourceTag/project, wherever the service supports the condition key;
#   - resource types that cannot be scoped by tag are scoped by name-prefix ARN;
#   - iam:PassRole is limited to the two Lambda execution roles;
#   - iam:CreateRole is allowed only with the project permissions boundary.
#
# The policy is split into managed policies by area so each stays under the
# 6,144 character limit. API Gateway and most CloudFront types have no resource
# name in their ARN, so they are scoped by ARN type and, where supported, by tag.

locals {
  # Names that every project role and resource carries, per environment.
  name_scope = {
    for e in local.envs : e => {
      role_arn_pattern     = "arn:aws:iam::${local.account_id}:role/compass-${e}-*"
      lambda_arn_pattern   = "arn:aws:lambda:${local.region}:${local.account_id}:function:compass-${e}-*"
      lambda_role_arns     = ["arn:aws:iam::${local.account_id}:role/compass-${e}-api-lambda", "arn:aws:iam::${local.account_id}:role/compass-${e}-passkit-lambda"]
      log_group_patterns   = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/compass-${e}-*", "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/apigateway/compass-${e}-*"]
      table_arns           = ["arn:aws:dynamodb:${local.region}:${local.account_id}:table/compass-${e}", "arn:aws:dynamodb:${local.region}:${local.account_id}:table/compass-${e}/index/*"]
      secret_pattern       = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:compass/${e}/*"
      topic_arn            = "arn:aws:sns:${local.region}:${local.account_id}:compass-${e}-alarms"
      alarm_pattern        = "arn:aws:cloudwatch:${local.region}:${local.account_id}:alarm:compass-${e}-*"
      budget_pattern       = "arn:aws:budgets::${local.account_id}:budget/compass-${e}-*"
      kms_alias_pattern    = "arn:aws:kms:${local.region}:${local.account_id}:alias/compass-${e}-*"
      bucket_patterns      = ["arn:aws:s3:::compass-${e}-site-*", "arn:aws:s3:::compass-${e}-site-*/*"]
      bucket_arn_pattern   = "arn:aws:s3:::compass-${e}-site-*"
      web_acl_pattern      = "arn:aws:wafv2:${local.region}:${local.account_id}:global/webacl/compass-${e}/*"
      cf_function_pattern  = "arn:aws:cloudfront::${local.account_id}:function/compass-${e}-*"
      cf_distribution_arns = "arn:aws:cloudfront::${local.account_id}:distribution/*"
    }
  }

  kms_key_arn_pattern = "arn:aws:kms:${local.region}:${local.account_id}:key/*"

  # ---- area: identity (IAM, Lambda, logs) --------------------------------
  apply_identity = {
    for e in local.envs : e => [
      {
        Sid      = "CreateBoundedRoles"
        Effect   = "Allow"
        Action   = ["iam:CreateRole"]
        Resource = local.name_scope[e].role_arn_pattern
        Condition = {
          StringEquals = {
            "aws:RequestTag/project"  = local.project_tag
            "iam:PermissionsBoundary" = local.boundary_policy_arn
          }
        }
      },
      {
        Sid    = "ManageProjectRoles"
        Effect = "Allow"
        Action = [
          "iam:DeleteRole",
          "iam:DeleteRolePolicy",
          "iam:PutRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:UpdateRole",
          "iam:UpdateRoleDescription",
        ]
        Resource  = local.name_scope[e].role_arn_pattern
        Condition = local.tag_on_manage
      },
      {
        Sid      = "KeepTheBoundary"
        Effect   = "Deny"
        Action   = ["iam:DeleteRolePermissionsBoundary"]
        Resource = local.name_scope[e].role_arn_pattern
      },
      {
        Sid      = "PassOnlyTheLambdaRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.name_scope[e].lambda_role_arns
        Condition = {
          StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" }
        }
      },
      {
        Sid       = "CreateLambdaFunctions"
        Effect    = "Allow"
        Action    = ["lambda:CreateFunction", "lambda:TagResource"]
        Resource  = local.name_scope[e].lambda_arn_pattern
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageLambdaFunctions"
        Effect = "Allow"
        Action = [
          "lambda:DeleteFunction",
          "lambda:TagResource",
          "lambda:UntagResource",
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
        ]
        Resource  = local.name_scope[e].lambda_arn_pattern
        Condition = local.tag_on_manage
      },
      {
        Sid      = "ManageLambdaInvokePermissions"
        Effect   = "Allow"
        Action   = ["lambda:AddPermission", "lambda:RemovePermission"]
        Resource = local.name_scope[e].lambda_arn_pattern
      },
      {
        Sid       = "CreateLogGroups"
        Effect    = "Allow"
        Action    = ["logs:CreateLogGroup", "logs:TagResource"]
        Resource  = local.name_scope[e].log_group_patterns
        Condition = local.tag_on_create
      },
      {
        Sid       = "ManageLogGroups"
        Effect    = "Allow"
        Action    = ["logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource"]
        Resource  = local.name_scope[e].log_group_patterns
        Condition = local.tag_on_manage
      },
    ]
  }

  # ---- area: data (DynamoDB, secrets, SNS, KMS, alarms, budget) ------------
  apply_data = {
    for e in local.envs : e => [
      {
        Sid       = "CreateTable"
        Effect    = "Allow"
        Action    = ["dynamodb:CreateTable", "dynamodb:TagResource"]
        Resource  = local.name_scope[e].table_arns
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageTable"
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteTable",
          "dynamodb:TagResource",
          "dynamodb:UntagResource",
          "dynamodb:UpdateContinuousBackups",
          "dynamodb:UpdateTable",
          "dynamodb:UpdateTimeToLive",
        ]
        Resource  = local.name_scope[e].table_arns
        Condition = local.tag_on_manage
      },
      {
        Sid       = "CreateSecrets"
        Effect    = "Allow"
        Action    = ["secretsmanager:CreateSecret", "secretsmanager:TagResource"]
        Resource  = local.name_scope[e].secret_pattern
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:DeleteSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:RestoreSecret",
          "secretsmanager:TagResource",
          "secretsmanager:UntagResource",
          "secretsmanager:UpdateSecret",
        ]
        Resource  = local.name_scope[e].secret_pattern
        Condition = local.tag_on_manage
      },
      {
        Sid       = "CreateTopic"
        Effect    = "Allow"
        Action    = ["sns:CreateTopic", "sns:TagResource"]
        Resource  = local.name_scope[e].topic_arn
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageTopic"
        Effect = "Allow"
        Action = [
          "sns:DeleteTopic",
          "sns:SetTopicAttributes",
          "sns:Subscribe",
          "sns:TagResource",
          "sns:Unsubscribe",
          "sns:UntagResource",
        ]
        Resource  = local.name_scope[e].topic_arn
        Condition = local.tag_on_manage
      },
      {
        Sid       = "CreateKey"
        Effect    = "Allow"
        Action    = ["kms:CreateKey", "kms:TagResource"]
        Resource  = "*"
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageKey"
        Effect = "Allow"
        Action = [
          "kms:CancelKeyDeletion",
          "kms:CreateAlias",
          "kms:DisableKeyRotation",
          "kms:EnableKeyRotation",
          "kms:PutKeyPolicy",
          "kms:ScheduleKeyDeletion",
          "kms:TagResource",
          "kms:UntagResource",
          "kms:UpdateKeyDescription",
        ]
        Resource  = local.kms_key_arn_pattern
        Condition = local.tag_on_manage
      },
      {
        Sid      = "ManageKeyAlias"
        Effect   = "Allow"
        Action   = ["kms:CreateAlias", "kms:DeleteAlias", "kms:UpdateAlias"]
        Resource = local.name_scope[e].kms_alias_pattern
      },
      {
        Sid       = "CreateAlarms"
        Effect    = "Allow"
        Action    = ["cloudwatch:PutMetricAlarm", "cloudwatch:TagResource"]
        Resource  = local.name_scope[e].alarm_pattern
        Condition = local.tag_on_create
      },
      {
        Sid       = "ManageAlarms"
        Effect    = "Allow"
        Action    = ["cloudwatch:DeleteAlarms", "cloudwatch:UntagResource"]
        Resource  = local.name_scope[e].alarm_pattern
        Condition = local.tag_on_manage
      },
      {
        Sid      = "ManageBudget"
        Effect   = "Allow"
        Action   = ["budgets:ModifyBudget", "budgets:ViewBudget"]
        Resource = local.name_scope[e].budget_pattern
      },
    ]
  }

  # ---- area: edge (S3, CloudFront, WAF, API Gateway) -----------------------
  apply_edge = {
    for e in local.envs : e => [
      {
        Sid    = "ManageSiteBucket"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:DeleteBucketPolicy",
          "s3:PutAccelerateConfiguration",
          "s3:PutBucket*",
          "s3:PutEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
        ]
        Resource = local.name_scope[e].bucket_arn_pattern
      },
      {
        Sid       = "CreateDistribution"
        Effect    = "Allow"
        Action    = ["cloudfront:CreateDistributionWithTags", "cloudfront:TagResource"]
        Resource  = "*"
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageDistribution"
        Effect = "Allow"
        Action = [
          "cloudfront:DeleteDistribution",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:UpdateDistribution",
        ]
        Resource  = local.name_scope[e].cf_distribution_arns
        Condition = local.tag_on_manage
      },
      {
        Sid    = "ManageCloudFrontFunction"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateFunction",
          "cloudfront:DeleteFunction",
          "cloudfront:PublishFunction",
          "cloudfront:UpdateFunction",
        ]
        Resource = local.name_scope[e].cf_function_pattern
      },
      {
        Sid    = "ManageCloudFrontPolicies"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:CreateResponseHeadersPolicy",
          "cloudfront:DeleteOriginAccessControl",
          "cloudfront:DeleteResponseHeadersPolicy",
          "cloudfront:UpdateOriginAccessControl",
          "cloudfront:UpdateResponseHeadersPolicy",
        ]
        Resource = [
          "arn:aws:cloudfront::${local.account_id}:origin-access-control/*",
          "arn:aws:cloudfront::${local.account_id}:response-headers-policy/*",
        ]
      },
      {
        Sid       = "CreateWebAcl"
        Effect    = "Allow"
        Action    = ["wafv2:CreateWebACL", "wafv2:TagResource"]
        Resource  = [local.name_scope[e].web_acl_pattern, "arn:aws:wafv2:${local.region}:${local.account_id}:global/managedruleset/*/*"]
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageWebAcl"
        Effect = "Allow"
        Action = [
          "wafv2:AssociateWebACL",
          "wafv2:DeleteWebACL",
          "wafv2:DisassociateWebACL",
          "wafv2:TagResource",
          "wafv2:UntagResource",
          "wafv2:UpdateWebACL",
        ]
        Resource  = [local.name_scope[e].web_acl_pattern, "arn:aws:wafv2:${local.region}:${local.account_id}:global/managedruleset/*/*"]
        Condition = local.tag_on_manage
      },
      {
        Sid      = "CheckWafCapacity"
        Effect   = "Allow"
        Action   = ["wafv2:CheckCapacity"]
        Resource = "*"
      },
      {
        Sid       = "CreateRestApi"
        Effect    = "Allow"
        Action    = ["apigateway:POST"]
        Resource  = "arn:aws:apigateway:${local.region}::/restapis"
        Condition = local.tag_on_create
      },
      {
        Sid    = "ManageRestApi"
        Effect = "Allow"
        Action = [
          "apigateway:DELETE",
          "apigateway:PATCH",
          "apigateway:POST",
          "apigateway:PUT",
        ]
        Resource = [
          "arn:aws:apigateway:${local.region}::/restapis/*",
          "arn:aws:apigateway:${local.region}::/tags/*",
        ]
      },
    ]
  }

  # ---- area: read (refresh during apply) -----------------------------------
  apply_read = {
    for e in local.envs : e => [
      {
        Sid      = "ReadOnly"
        Effect   = "Allow"
        Action   = local.read_actions
        Resource = "*"
      },
      local.secret_value_deny[e],
    ]
  }

  apply_areas = {
    identity = local.apply_identity
    data     = local.apply_data
    edge     = local.apply_edge
    read     = local.apply_read
  }

  # One managed policy per environment and area, keyed "<env>-<area>".
  apply_policies = merge([
    for area, by_env in local.apply_areas : {
      for e in local.envs : "${e}-${area}" => {
        env  = e
        area = area
        json = jsonencode({ Version = "2012-10-17", Statement = by_env[e] })
      }
    }
  ]...)
}

resource "aws_iam_role" "apply" {
  for_each = local.envs

  name                 = "compass-${each.key}-hcp-apply"
  description          = "HCP Terraform apply phase for the ${each.key} environment. Scoped to project resources."
  assume_role_policy   = local.trust_policies["apply"][each.key]
  max_session_duration = 3600
}

resource "aws_iam_policy" "apply" {
  for_each = local.apply_policies

  name        = "compass-${each.key}-hcp-apply"
  description = "Apply phase permissions, ${each.value.area} area, ${each.value.env} environment."
  policy      = each.value.json
}

resource "aws_iam_role_policy_attachment" "apply" {
  for_each = local.apply_policies

  role       = aws_iam_role.apply[each.value.env].name
  policy_arn = aws_iam_policy.apply[each.key].arn
}

# The boundary caps every role the apply phase creates. A Lambda role can never
# do more than write its own logs, use the Compass tables and read the Compass
# secrets, whatever its own policy says.
resource "aws_iam_policy" "boundary" {
  name        = local.boundary_policy_name
  description = "Permissions boundary for roles created by the apply phase."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/compass-*:*"
      },
      {
        Sid    = "UseCompassTables"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = [
          "arn:aws:dynamodb:${local.region}:${local.account_id}:table/compass-*",
          "arn:aws:dynamodb:${local.region}:${local.account_id}:table/compass-*/index/*",
        ]
      },
      {
        Sid      = "ReadCompassSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:compass/*"
      },
    ]
  })
}
