output "bucket_name" {
  description = "S3 bucket name — set as SUPPORT_TICKETS_S3_BUCKET"
  value       = aws_s3_bucket.support_tickets.bucket
}

output "bucket_arn" {
  description = "S3 bucket ARN — grant s3:PutObject/GetObject on this to the SES-scoped IAM user (see modules/secrets), the same static credentials S3Service reuses for support-ticket screenshot uploads. Not managed by Terraform, same as that user's SES permissions."
  value       = aws_s3_bucket.support_tickets.arn
}
