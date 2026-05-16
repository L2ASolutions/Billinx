output "app_log_group_name" {
  description = "ECS task log group name"
  value       = aws_cloudwatch_log_group.ecs.name
}

output "application_log_group_name" {
  description = "Application-level log group name"
  value       = aws_cloudwatch_log_group.application.name
}

output "sns_topic_arn" {
  description = "SNS topic ARN for billing alerts"
  value       = aws_sns_topic.alerts.arn
}
