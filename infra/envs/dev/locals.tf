data "aws_caller_identity" "current" {}

locals {
  # Required tags on every managed resource, applied through provider default_tags
  # (Requirement 1.9).
  tags = {
    project     = "reinvent-compass"
    environment = var.env
  }

  # Prefix of the site bucket name. S3 appends a unique suffix, so the name
  # carries no account identifier.
  site_bucket_name_prefix = "compass-${var.env}-site-"

  # The shared permissions boundary created by the bootstrap. The apply role may
  # create a role only when it carries this policy.
  permissions_boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/compass-permissions-boundary"

  google_wallet_class_suffix = coalesce(var.google_wallet_class_suffix, "compass-${var.env}")
}
