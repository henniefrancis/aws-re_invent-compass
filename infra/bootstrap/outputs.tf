# The role ARNs embed the account identifier, so every output here is sensitive
# (Requirement 17.1). The owner reads them once with terraform output, for
# example terraform output -json plan_role_arns, and pastes them into the HCP
# workspace variables TFC_AWS_PLAN_ROLE_ARN and TFC_AWS_APPLY_ROLE_ARN.

output "plan_role_arns" {
  description = "ARNs of the dev and prod plan roles, for the HCP workspace variable TFC_AWS_PLAN_ROLE_ARN."
  value       = { for e, r in aws_iam_role.plan : e => r.arn }
  sensitive   = true
}

output "apply_role_arns" {
  description = "ARNs of the dev and prod apply roles, for the HCP workspace variable TFC_AWS_APPLY_ROLE_ARN."
  value       = { for e, r in aws_iam_role.apply : e => r.arn }
  sensitive   = true
}
