variable "app_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  description = "VPC ID to attach security groups to"
  type        = string
}
