variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "af-south-1"
}

variable "aws_account_id" {
  description = "AWS account ID (12-digit number)"
  type        = string
}

variable "app_name" {
  description = "Application name used for resource naming"
  type        = string
  default     = "billinx"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

# ── Networking ────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "availability_zones" {
  type    = list(string)
  default = ["af-south-1a", "af-south-1b"]
}

# ── Domain and TLS ────────────────────────────────────────────────────────────

variable "domain_name" {
  description = "Primary domain name (e.g. api.billinx.ng)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the domain (must be in af-south-1)"
  type        = string
}

# ── Database ──────────────────────────────────────────────────────────────────

variable "db_password" {
  description = "RDS master password (16+ chars, no @ % / characters)"
  type        = string
  sensitive   = true
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "billinx"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

# ── ElastiCache ───────────────────────────────────────────────────────────────

variable "redis_auth_token" {
  description = "Redis AUTH token (16-128 chars, alphanumeric + symbols except @)"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

# ── ECS ───────────────────────────────────────────────────────────────────────

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "desired_count" {
  description = "Number of ECS task replicas"
  type        = number
  default     = 1
}

# ── Alerting ──────────────────────────────────────────────────────────────────

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications (leave empty to skip)"
  type        = string
  default     = ""
}
