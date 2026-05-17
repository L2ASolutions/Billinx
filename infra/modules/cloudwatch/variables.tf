variable "app_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }

variable "ecs_cluster_name" {
  description = "ECS cluster name for CloudWatch metrics"
  type        = string
}

variable "ecs_service_name" {
  description = "ECS service name for CloudWatch metrics"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix for CloudWatch metrics"
  type        = string
}

variable "rds_instance_identifier" {
  description = "RDS instance identifier for CloudWatch metrics"
  type        = string
}

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications"
  type        = string
  default     = ""
}
