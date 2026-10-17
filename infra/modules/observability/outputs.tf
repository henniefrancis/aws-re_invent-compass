output "sns_topic_arn" {
  description = "ARN of the alarm topic. The alarm email address is never output."
  value       = aws_sns_topic.alarms.arn
}
