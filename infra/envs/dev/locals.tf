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
  permissions_boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/compass-${var.env}-boundary"

  google_wallet_class_suffix = coalesce(var.google_wallet_class_suffix, "compass-${var.env}")

  extra_aliases = var.extra_aliases == null ? [] : var.extra_aliases

  # The public base URL the Lambdas put in boardUrl and in the pass webServiceURL.
  # With a custom domain it is known up front (https://<domain_name>), which ends
  # the two-apply dance. An explicit public_base_url wins; with no domain and no
  # value it stays empty until the owner sets it after the first apply.
  public_base_url = var.public_base_url != "" ? var.public_base_url : (var.domain_name == null ? "" : "https://${var.domain_name}")
}
