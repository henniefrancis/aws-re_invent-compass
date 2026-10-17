output "distribution_arn" {
  description = "ARN of the CloudFront distribution, used to scope the site bucket policy."
  value       = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  description = "Public CloudFront domain name (attendees need it)."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_id" {
  description = "ID of the CloudFront distribution, used by the release script to invalidate the cache."
  value       = aws_cloudfront_distribution.this.id
}
