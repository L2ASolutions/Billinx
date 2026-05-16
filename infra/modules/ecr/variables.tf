variable "app_name" { type = string }
variable "environment" { type = string }

variable "repository_name" {
  description = "ECR repository name"
  type        = string
  default     = "billinx-api"
}

variable "max_images_to_keep" {
  description = "Maximum number of images to retain in ECR"
  type        = number
  default     = 10
}
