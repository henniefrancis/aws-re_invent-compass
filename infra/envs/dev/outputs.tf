# Non-sensitive values only (Requirement 17.1). The CloudFront domain is public
# because attendees need it. The distribution id and the site bucket name are
# resource names, not secrets, and the release script uses them to invalidate the
# cache and sync the site. Nothing here carries an account identifier, an email
# address, a secret or a token.

output "cloudfront_domain_name" {
  description = "Public CloudFront domain name of this environment."
  value       = module.edge.distribution_domain_name
}

output "distribution_id" {
  description = "CloudFront distribution id, used by the release script to invalidate the cache."
  value       = module.edge.distribution_id
}

output "site_bucket_name" {
  description = "Name of the site bucket, used by the release script to sync the built site."
  value       = module.site.bucket_name
}
