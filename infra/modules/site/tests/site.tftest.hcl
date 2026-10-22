# Plan-only assertions for the site module (Requirements 3.1 to 3.5, 9.4).

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::compass-dev-site-example"
    }
  }
}

variables {
  bucket_name_prefix = "compass-dev-site-"
  distribution_arn   = "arn:aws:cloudfront::example:distribution/EEXAMPLE"
  wallet_images_dir  = "tests/fixtures/wallet"
}

run "bucket_hardening" {
  command = plan

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.this.block_public_acls,
      aws_s3_bucket_public_access_block.this.ignore_public_acls,
      aws_s3_bucket_public_access_block.this.block_public_policy,
      aws_s3_bucket_public_access_block.this.restrict_public_buckets,
    ])
    error_message = "All four public access block settings must be true."
  }

  assert {
    condition     = one(one(aws_s3_bucket_server_side_encryption_configuration.this.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    error_message = "Default encryption must be SSE-S3 (AES256)."
  }

  assert {
    condition     = one(aws_s3_bucket_versioning.this.versioning_configuration).status == "Enabled"
    error_message = "Versioning must be enabled."
  }

  assert {
    condition     = aws_s3_bucket.this.force_destroy == false
    error_message = "The bucket must not allow force destroy."
  }
}

run "force_destroy_is_a_teardown_switch" {
  command = plan

  variables {
    force_destroy = true
  }

  assert {
    condition     = aws_s3_bucket.this.force_destroy
    error_message = "The teardown runbook must be able to let Terraform empty the bucket."
  }
}

run "origin_access_control" {
  command = plan

  assert {
    condition     = aws_cloudfront_origin_access_control.this.origin_access_control_origin_type == "s3" && aws_cloudfront_origin_access_control.this.signing_protocol == "sigv4" && aws_cloudfront_origin_access_control.this.signing_behavior == "always"
    error_message = "The OAC must sign S3 origin requests with sigv4, always."
  }
}

run "bucket_policy_scoped_to_distribution" {
  command = plan

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.this.policy).Statement[0].Action == "s3:GetObject" && jsondecode(aws_s3_bucket_policy.this.policy).Statement[0].Effect == "Allow"
    error_message = "The only allow statement must grant s3:GetObject."
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.this.policy).Statement[0].Condition.StringEquals["AWS:SourceArn"] == var.distribution_arn
    error_message = "The allow statement must be conditioned on the distribution ARN."
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.this.policy).Statement[1].Effect == "Deny" && jsondecode(aws_s3_bucket_policy.this.policy).Statement[1].Condition.ArnNotEquals["AWS:SourceArn"] == var.distribution_arn
    error_message = "Every other reader must be denied."
  }

  assert {
    condition     = length([for s in jsondecode(aws_s3_bucket_policy.this.policy).Statement : s if s.Effect == "Allow"]) == 1
    error_message = "The policy must contain exactly one allow statement."
  }
}

run "invalid_prefix_is_rejected" {
  command = plan

  variables {
    bucket_name_prefix = "Bad_Prefix"
  }

  expect_failures = [var.bucket_name_prefix]
}

run "invalid_distribution_arn_is_rejected" {
  command = plan

  variables {
    distribution_arn = "not-an-arn"
  }

  expect_failures = [var.distribution_arn]
}

# Static HCL scan: prevent_destroy is a lifecycle meta-argument that plan output
# does not show, and the trivy ignore must stay on the encryption block with its
# justification.
run "source_scan" {
  command = plan

  assert {
    condition     = can(regex("(?s)resource[[:space:]]+\"aws_s3_bucket\"[[:space:]]+\"this\"[^}]*lifecycle[[:space:]]*[{][^}]*prevent_destroy[[:space:]]*=[[:space:]]*true", file("${path.module}/main.tf")))
    error_message = "The site bucket must set prevent_destroy = true."
  }

  assert {
    condition     = length(regexall("trivy:ignore", file("${path.module}/main.tf"))) == 1 && can(regex("trivy:ignore:AVD-AWS-0132[^\n]*Requirement 3[.]2[^\n]*\nresource[[:space:]]+\"aws_s3_bucket_server_side_encryption_configuration\"", file("${path.module}/main.tf")))
    error_message = "Only the documented AVD-AWS-0132 suppression is allowed, directly above the encryption block."
  }
}

# Pass-service task 47, design item 42: the Google Wallet images are public through the
# distribution under wallet/, as long-cached PNGs, in the site bucket.
run "wallet_images" {
  command = plan

  assert {
    condition     = toset(keys(aws_s3_object.wallet_image)) == toset(["wide-logo-v1.png", "hero-v1.png"])
    error_message = "The site module must upload exactly the two Google Wallet images."
  }

  assert {
    condition = alltrue([
      for name, image in aws_s3_object.wallet_image :
      image.key == "wallet/${name}" && image.content_type == "image/png" && image.cache_control == "public, max-age=31536000, immutable"
    ])
    error_message = "Each image must live under wallet/ as image/png with a one-year immutable cache header."
  }

  assert {
    condition     = alltrue([for image in aws_s3_object.wallet_image : image.etag == filemd5("tests/fixtures/wallet/${trimprefix(image.key, "wallet/")}")])
    error_message = "Each image etag must be the MD5 of its file, so a changed file is uploaded again."
  }

  assert {
    condition     = output.wallet_image_keys == tolist(["wallet/hero-v1.png", "wallet/wide-logo-v1.png"])
    error_message = "The module must output the two image keys."
  }
}
