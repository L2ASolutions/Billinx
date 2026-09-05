variable "app_name" { type = string }
variable "environment" { type = string }

variable "screenshot_retention_days" {
  description = "Days before a support-ticket screenshot is auto-expired from S3"
  type        = number
  default     = 180
}
