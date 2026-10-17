output "bucket_regional_domain_name" {
  description = "Regional domain name of the site bucket, used as the CloudFront origin."
  value       = aws_s3_bucket.this.bucket_regional_domain_name
}

output "bucket_arn" {
  description = "ARN of the site bucket."
  value       = aws_s3_bucket.this.arn
}

output "bucket_name" {
  description = "Name of the site bucket, used by the release script to sync the site."
  value       = aws_s3_bucket.this.id
}

output "oac_id" {
  description = "ID of the CloudFront origin access control."
  value       = aws_cloudfront_origin_access_control.this.id
}
