# API Gateway writes access logs with one account-wide CloudWatch Logs role.
# The role and the aws_api_gateway_account setting exist once per account, here,
# and never in an environment root (Requirements 2.7 and 5.14).
resource "aws_iam_role" "apigateway_cloudwatch" {
  name        = "compass-apigateway-cloudwatch"
  description = "Lets API Gateway write access logs to CloudWatch Logs for the whole account."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "apigateway.amazonaws.com" }
      # Confused deputy guard: only API Gateway acting for this account. No
      # aws:SourceArn: UpdateAccount checks the role before any REST API is
      # involved, and a /restapis/* source ARN made that check fail.
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apigateway_cloudwatch" {
  role       = aws_iam_role.apigateway_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.apigateway_cloudwatch.arn

  depends_on = [aws_iam_role_policy_attachment.apigateway_cloudwatch]
}
