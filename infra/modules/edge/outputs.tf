output "distribution_arn" {
  description = "ARN of the CloudFront distribution, used to scope the site bucket policy."
  value       = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  description = "Public CloudFront domain name (attendees need it)."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "public_domain_names" {
  description = "The custom domain names that serve the distribution (empty when it uses the CloudFront default domain)."
  value       = local.aliases
}

output "web_acl_name" {
  description = "Name of the WAF web ACL, the WebACL dimension of its CloudWatch metrics."
  value       = aws_wafv2_web_acl.this.name
}

output "distribution_id" {
  description = "ID of the CloudFront distribution, used by the release script to invalidate the cache."
  value       = aws_cloudfront_distribution.this.id
}
