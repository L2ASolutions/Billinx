variable "app_name" { type = string }
variable "environment" { type = string }

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
}

variable "health_check_path" {
  description = "Health check path"
  type        = string
  default     = "/health"
}

variable "app_port" {
  description = "Port the ECS tasks listen on"
  type        = number
  default     = 3000
}
