variable "app_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "aws_account_id" { type = string }

variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "ecs_security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "ecr_repository_url" { type = string }
variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "task_cpu" {
  description = "ECS task CPU units"
  type        = string
  default     = "512"
}

variable "task_memory" {
  description = "ECS task memory (MB)"
  type        = string
  default     = "1024"
}

variable "desired_count" {
  description = "Desired number of ECS task replicas"
  type        = number
  default     = 1
}

variable "app_port" {
  description = "Container port"
  type        = number
  default     = 3000
}

variable "log_group_name" {
  description = "CloudWatch log group for ECS tasks"
  type        = string
}

# Secret ARNs injected into the task as environment variables
variable "secret_arns" {
  description = "Map of env var name to Secrets Manager secret ARN"
  type        = map(string)
}

# Non-secret environment variables
variable "app_env_vars" {
  description = "Non-sensitive environment variables passed to the container"
  type        = map(string)
  default     = {}
}
