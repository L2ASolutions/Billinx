variable "app_name" { type = string }
variable "environment" { type = string }

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for RDS"
  type        = string
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "billinx"
}

variable "db_username" {
  description = "Master database username"
  type        = string
  default     = "billinx"
}

variable "db_password" {
  description = "Master database password (use a strong random value)"
  type        = string
  sensitive   = true
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "backup_retention_days" {
  description = "Automated backup retention period in days"
  type        = number
  default     = 7
}

variable "postgres_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.7"
}
