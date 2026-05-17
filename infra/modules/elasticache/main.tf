locals {
  tags = {
    App         = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_elasticache_subnet_group" "main" {
  name        = "${var.app_name}-${var.environment}-redis-subnet-group"
  description = "Subnet group for ${var.app_name} Redis cluster"
  subnet_ids  = var.subnet_ids

  tags = merge(local.tags, { Name = "${var.app_name}-${var.environment}-redis-subnet-group" })
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.app_name}-${var.environment}"
  engine               = "redis"
  engine_version       = var.redis_version
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.security_group_id]

  # Encryption
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.auth_token

  # Maintenance
  maintenance_window       = "sun:03:00-sun:04:00"
  snapshot_retention_limit = 1
  snapshot_window          = "02:00-03:00"

  apply_immediately = false

  tags = merge(local.tags, { Name = "${var.app_name}-${var.environment}-redis" })
}
