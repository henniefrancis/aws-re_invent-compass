output "app_secret_arn" {
  description = "ARN of the app secret container (pepper and origin-verify value, loaded by the owner)."
  value       = aws_secretsmanager_secret.app.arn
}

output "apple_secret_arn" {
  description = "ARN of the Apple pass secret container."
  value       = aws_secretsmanager_secret.apple_pass.arn
}

output "google_secret_arn" {
  description = "ARN of the Google Wallet secret container."
  value       = aws_secretsmanager_secret.google_wallet.arn
}
