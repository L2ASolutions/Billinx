output "alb_dns_name" {
  description = "ALB DNS name — configure your domain CNAME to point here"
  value       = module.alb.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID (for Route 53 alias records)"
  value       = module.alb.alb_zone_id
}

output "ecr_repository_url" {
  description = "ECR repository URL for Docker push"
  value       = module.ecr.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs.service_name
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = module.rds.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = module.elasticache.primary_endpoint
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "sns_alerts_topic_arn" {
  description = "SNS topic ARN for billing alerts"
  value       = module.cloudwatch.sns_topic_arn
}

output "secret_names" {
  description = "All Secrets Manager secret names — populate these after apply"
  value       = module.secrets.secret_names
}

output "database_url_format" {
  description = "DATABASE_URL format to store in Secrets Manager"
  value       = "postgresql://${var.db_username}:PASSWORD@${module.rds.db_host}:5432/billinx"
  sensitive   = false
}

output "redis_url_format" {
  description = "REDIS_URL format to store in Secrets Manager (use your auth_token)"
  value       = "rediss://:AUTH_TOKEN@${module.elasticache.primary_endpoint}:6379"
  sensitive   = false
}
