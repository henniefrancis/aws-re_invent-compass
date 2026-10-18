variable "bucket_name_prefix" {
  description = "Prefix for the site bucket name. S3 appends a unique suffix, so the name carries no account identifier."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,35}-$", var.bucket_name_prefix))
    error_message = "The bucket_name_prefix value must be lowercase letters, digits and hyphens, end with a hyphen, and be at most 37 characters."
  }
}

variable "distribution_arn" {
  description = "ARN of the CloudFront distribution that may read the bucket (from the edge module)."
  type        = string

  validation {
    condition     = startswith(var.distribution_arn, "arn:aws:cloudfront::") && strcontains(var.distribution_arn, ":distribution/")
    error_message = "The distribution_arn value must be a CloudFront distribution ARN."
  }
}

variable "force_destroy" {
  description = "Let Terraform empty and delete a non-empty site bucket. False by default; only the teardown runbook sets it true."
  type        = bool
  default     = false
}
