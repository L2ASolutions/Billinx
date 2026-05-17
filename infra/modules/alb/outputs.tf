output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "ALB DNS name (use this to configure your CNAME/A record)"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID (for Route 53 alias records)"
  value       = aws_lb.main.zone_id
}

output "target_group_arn" {
  description = "Target group ARN for ECS service"
  value       = aws_lb_target_group.app.arn
}

output "https_listener_arn" {
  description = "HTTPS listener ARN"
  value       = aws_lb_listener.https.arn
}
