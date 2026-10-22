# Private, versioned site bucket reachable only through CloudFront (Requirement
# 3). Retained resource (ADR-015): prevent_destroy so a mistaken plan cannot take
# the live site down.
resource "aws_s3_bucket" "this" {
  bucket_prefix = var.bucket_name_prefix
  force_destroy = var.force_destroy

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# trivy:ignore:AVD-AWS-0132 Requirement 3.2 mandates SSE-S3 (AES256): the bucket holds only the public showcase site, so a customer managed KMS key adds cost and key management with no privacy benefit.
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = local.oac_name
  description                       = "Origin access control for the Compass site bucket."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront reads objects only when the request comes from the distribution.
# An explicit deny closes object reads for every other principal, and a second
# deny refuses plain HTTP. Uploads by the owner are unaffected: the site sync
# lists and writes objects and never reads them.
resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id

  # The public access block must exist first so the policy is never evaluated
  # against a half-configured bucket.
  depends_on = [aws_s3_bucket_public_access_block.this]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.this.arn}/*"
        Condition = {
          StringEquals = { "AWS:SourceArn" = var.distribution_arn }
        }
      },
      {
        Sid       = "DenyReadFromAnythingElse"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.this.arn}/*"
        Condition = {
          ArnNotEquals = { "AWS:SourceArn" = var.distribution_arn }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })
}

# The Google Wallet pass images (pass-service task 47, design item 42). Google fetches
# an image by its public HTTPS URL, so these are served by the distribution at
# /wallet/<name> through the same OAC. The names are listed, not globbed, so a missing
# file fails the plan instead of deleting a live image; a changed picture gets a new
# versioned name, since Google caches images by URL. The release sync excludes wallet/.
resource "aws_s3_object" "wallet_image" {
  for_each = local.wallet_images

  bucket        = aws_s3_bucket.this.id
  key           = "wallet/${each.key}"
  source        = "${var.wallet_images_dir}/${each.key}"
  etag          = filemd5("${var.wallet_images_dir}/${each.key}")
  content_type  = "image/png"
  cache_control = "public, max-age=31536000, immutable"
}
