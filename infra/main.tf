terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "billinx-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "af-south-1"
    encrypt        = true
    dynamodb_table = "billinx-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      App         = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── Networking ────────────────────────────────────────────────────────────────

module "vpc" {
  source = "./modules/vpc"

  app_name             = var.app_name
  environment          = var.environment
  aws_region           = var.aws_region
  vpc_cidr             = var.vpc_cidr
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  availability_zones   = var.availability_zones
}

module "security_groups" {
  source = "./modules/security-groups"

  app_name    = var.app_name
  environment = var.environment
  vpc_id      = module.vpc.vpc_id
}

# ── Data ──────────────────────────────────────────────────────────────────────

module "rds" {
  source = "./modules/rds"

  app_name          = var.app_name
  environment       = var.environment
  subnet_ids        = module.vpc.private_subnet_ids
  security_group_id = module.security_groups.rds_sg_id
  db_password       = var.db_password
  db_username       = var.db_username
  instance_class    = var.db_instance_class
}

module "elasticache" {
  source = "./modules/elasticache"

  app_name          = var.app_name
  environment       = var.environment
  subnet_ids        = module.vpc.private_subnet_ids
  security_group_id = module.security_groups.redis_sg_id
  auth_token        = var.redis_auth_token
  node_type         = var.redis_node_type
}

# ── Container Registry ────────────────────────────────────────────────────────

module "ecr" {
  source = "./modules/ecr"

  app_name    = var.app_name
  environment = var.environment
}

# ── Secrets ───────────────────────────────────────────────────────────────────

module "secrets" {
  source = "./modules/secrets"

  app_name    = var.app_name
  environment = var.environment
}

# ── Load Balancer ─────────────────────────────────────────────────────────────

module "alb" {
  source = "./modules/alb"

  app_name          = var.app_name
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  security_group_id = module.security_groups.alb_sg_id
  certificate_arn   = var.certificate_arn
}

# ── Observability ─────────────────────────────────────────────────────────────

module "cloudwatch" {
  source = "./modules/cloudwatch"

  app_name                = var.app_name
  environment             = var.environment
  aws_region              = var.aws_region
  ecs_cluster_name        = module.ecs.cluster_name
  ecs_service_name        = module.ecs.service_name
  alb_arn_suffix          = module.alb.alb_arn
  rds_instance_identifier = module.rds.instance_id
  alert_email             = var.alert_email

  depends_on = [module.ecs, module.alb, module.rds]
}

# ── ECS ───────────────────────────────────────────────────────────────────────

module "ecs" {
  source = "./modules/ecs"

  app_name               = var.app_name
  environment            = var.environment
  aws_region             = var.aws_region
  aws_account_id         = var.aws_account_id
  vpc_id                 = module.vpc.vpc_id
  private_subnet_ids     = module.vpc.private_subnet_ids
  ecs_security_group_id  = module.security_groups.ecs_sg_id
  target_group_arn       = module.alb.target_group_arn
  ecr_repository_url     = module.ecr.repository_url
  image_tag              = var.image_tag
  desired_count          = var.desired_count
  log_group_name         = module.cloudwatch.app_log_group_name

  # Secrets injected as env vars via Secrets Manager
  secret_arns = {
    DATABASE_URL             = module.secrets.secret_arns["database_url"]
    JWT_SECRET               = module.secrets.secret_arns["jwt_secret"]
    ADMIN_JWT_SECRET         = module.secrets.secret_arns["admin_jwt_secret"]
    REDIS_URL                = module.secrets.secret_arns["redis_url"]
    AWS_ACCESS_KEY_ID        = module.secrets.secret_arns["aws_ses_key"]
    AWS_SECRET_ACCESS_KEY    = module.secrets.secret_arns["aws_ses_secret"]
    CAC_API_KEY              = module.secrets.secret_arns["cac_api_key"]
    # Secret IDs — the app fetches these secrets from Secrets Manager at runtime
    MASTER_KEY_SECRET_ID     = module.secrets.secret_arns["encryption_key"]
    ADMIN_KEY_SECRET_ID      = module.secrets.secret_arns["admin_api_key"]
    JWT_PRIVATE_KEY_SECRET_ID = module.secrets.secret_arns["jwt_private_key"]
    JWT_PUBLIC_KEY_SECRET_ID  = module.secrets.secret_arns["jwt_public_key"]
  }

  # Non-secret environment variables
  app_env_vars = {
    NODE_ENV              = "production"
    PORT                  = "3000"
    AWS_REGION            = var.aws_region
    AWS_SES_REGION        = "us-east-1"
    MFA_ISSUER            = "Billinx"
    APP_BASE_URL          = "https://${var.domain_name}"
    EMAIL_FROM            = "Billinx <noreply@billinx.ng>"
    INTERSWITCH_PROD_URL  = "https://api.interswitchgroup.com"
    INTERSWITCH_SANDBOX_URL = "https://qa.interswitchgroup.com"
    CAC_API_BASE_URL      = "https://services.erca.gov.ng/api/companies"
  }

  depends_on = [module.cloudwatch, module.secrets, module.alb]
}
