locals {
  tags = {
    App         = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_db_subnet_group" "main" {
  name        = "${var.app_name}-${var.environment}-db-subnet-group"
  description = "Subnet group for ${var.app_name} RDS instance"
  subnet_ids  = var.subnet_ids

  tags = merge(local.tags, { Name = "${var.app_name}-${var.environment}-db-subnet-group" })
}

resource "aws_db_instance" "main" {
  identifier = "${var.app_name}-${var.environment}"

  engine         = "postgres"
  engine_version = var.postgres_version

  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]

  multi_az               = false
  publicly_accessible    = false
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.app_name}-${var.environment}-final-snapshot"
  deletion_protection    = true

  backup_retention_period = var.backup_retention_days
  backup_window           = "02:00-03:00"
  maintenance_window      = "Mon:03:00-Mon:04:00"

  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  performance_insights_enabled = false

  tags = merge(local.tags, { Name = "${var.app_name}-${var.environment}-postgres" })
}
