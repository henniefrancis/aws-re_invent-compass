output "rest_api_id" {
  description = "ID of the REST API."
  value       = aws_api_gateway_rest_api.this.id
}

output "rest_api_name" {
  description = "Name of the REST API, the ApiName metric dimension used by the alarms."
  value       = aws_api_gateway_rest_api.this.name
}

# Host only, with no scheme and no stage path: CloudFront adds the /live origin
# path itself.
output "stage_invoke_host" {
  description = "Host name of the live stage, used as the CloudFront API origin."
  value       = split("/", aws_api_gateway_stage.live.invoke_url)[2]
}

output "api_lambda_name" {
  description = "Name of the api Lambda function."
  value       = aws_lambda_function.api.function_name
}

output "passkit_lambda_name" {
  description = "Name of the passkit Lambda function."
  value       = aws_lambda_function.passkit.function_name
}

output "api_lambda_role_arn" {
  description = "ARN of the api Lambda execution role."
  value       = aws_iam_role.api.arn
}

output "passkit_lambda_role_arn" {
  description = "ARN of the passkit Lambda execution role."
  value       = aws_iam_role.passkit.arn
}
