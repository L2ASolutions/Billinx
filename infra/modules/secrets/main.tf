locals {
  prefix = "billinx/${var.environment}"
  tags = {
    App         = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Helper to create a secret with a placeholder value.
# Real values are populated after apply using update-secrets.sh.

# ── DATABASE_URL ──────────────────────────────────────────────────────────────
# Maps to: DATABASE_URL env var in ECS task
# Format:  postgresql://USER:PASSWORD@HOST:5432/billinx
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.prefix}/database-url"
  description             = "Full PostgreSQL connection URL for the Billinx API"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "DATABASE_URL" })
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"

  lifecycle { ignore_changes = [secret_string] }
}

# ── JWT_SECRET ────────────────────────────────────────────────────────────────
# Maps to: JWT_SECRET env var in ECS task
# Format:  64+ character random string
resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${local.prefix}/jwt-secret"
  description             = "JWT signing secret for user sessions"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "JWT_SECRET" })
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── ADMIN_JWT_SECRET ──────────────────────────────────────────────────────────
# Maps to: ADMIN_JWT_SECRET env var in ECS task
# Format:  64+ character random string (different from JWT_SECRET)
resource "aws_secretsmanager_secret" "admin_jwt_secret" {
  name                    = "${local.prefix}/admin-jwt-secret"
  description             = "JWT signing secret for admin sessions"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "ADMIN_JWT_SECRET" })
}

resource "aws_secretsmanager_secret_version" "admin_jwt_secret" {
  secret_id     = aws_secretsmanager_secret.admin_jwt_secret.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── ENCRYPTION_KEY (master key) ───────────────────────────────────────────────
# Maps to: MASTER_KEY_SECRET_ID env var → SecretsService fetches this secret at runtime
# Format:  64-character hex string (32 bytes)
resource "aws_secretsmanager_secret" "encryption_key" {
  name                    = "${local.prefix}/encryption-key"
  description             = "AES-256-GCM master encryption key (64-char hex)"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "MASTER_KEY_SECRET_ID" })
}

resource "aws_secretsmanager_secret_version" "encryption_key" {
  secret_id     = aws_secretsmanager_secret.encryption_key.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── ADMIN_API_KEY (admin key hash) ────────────────────────────────────────────
# Maps to: ADMIN_KEY_SECRET_ID env var → SecretsService fetches this secret at runtime
# Format:  bcrypt hash of the admin key
resource "aws_secretsmanager_secret" "admin_api_key" {
  name                    = "${local.prefix}/admin-api-key"
  description             = "bcrypt hash of the platform admin API key"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "ADMIN_KEY_SECRET_ID" })
}

resource "aws_secretsmanager_secret_version" "admin_api_key" {
  secret_id     = aws_secretsmanager_secret.admin_api_key.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── JWT_PRIVATE_KEY ───────────────────────────────────────────────────────────
# Maps to: JWT_PRIVATE_KEY_SECRET_ID env var → SecretsService fetches this at runtime
# Format:  PEM-encoded RSA private key
resource "aws_secretsmanager_secret" "jwt_private_key" {
  name                    = "${local.prefix}/jwt-private-key"
  description             = "RSA private key for JWT signing"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "JWT_PRIVATE_KEY_SECRET_ID" })
}

resource "aws_secretsmanager_secret_version" "jwt_private_key" {
  secret_id     = aws_secretsmanager_secret.jwt_private_key.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── JWT_PUBLIC_KEY ────────────────────────────────────────────────────────────
# Maps to: JWT_PUBLIC_KEY_SECRET_ID env var → SecretsService fetches this at runtime
# Format:  PEM-encoded RSA public key
resource "aws_secretsmanager_secret" "jwt_public_key" {
  name                    = "${local.prefix}/jwt-public-key"
  description             = "RSA public key for JWT verification"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "JWT_PUBLIC_KEY_SECRET_ID" })
}

resource "aws_secretsmanager_secret_version" "jwt_public_key" {
  secret_id     = aws_secretsmanager_secret.jwt_public_key.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── ADMIN_KEY_HASH ────────────────────────────────────────────────────────────
# Used internally by SecretsService.getAdminKeyHash()
resource "aws_secretsmanager_secret" "admin_key_hash" {
  name                    = "${local.prefix}/admin-key-hash"
  description             = "bcrypt hash of the L2A Solutions admin panel key"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "ADMIN_KEY_SECRET_ID" })
}

resource "aws_secretsmanager_secret_version" "admin_key_hash" {
  secret_id     = aws_secretsmanager_secret.admin_key_hash.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── AWS_SES_KEY ───────────────────────────────────────────────────────────────
# Maps to: AWS_ACCESS_KEY_ID env var (SES-scoped IAM user)
resource "aws_secretsmanager_secret" "aws_ses_key" {
  name                    = "${local.prefix}/aws-ses-key"
  description             = "AWS IAM access key ID for SES email delivery"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "AWS_ACCESS_KEY_ID" })
}

resource "aws_secretsmanager_secret_version" "aws_ses_key" {
  secret_id     = aws_secretsmanager_secret.aws_ses_key.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── AWS_SES_SECRET ────────────────────────────────────────────────────────────
# Maps to: AWS_SECRET_ACCESS_KEY env var (SES-scoped IAM user)
resource "aws_secretsmanager_secret" "aws_ses_secret" {
  name                    = "${local.prefix}/aws-ses-secret"
  description             = "AWS IAM secret access key for SES email delivery"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "AWS_SECRET_ACCESS_KEY" })
}

resource "aws_secretsmanager_secret_version" "aws_ses_secret" {
  secret_id     = aws_secretsmanager_secret.aws_ses_secret.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── INTERSWITCH_BASE_URL ──────────────────────────────────────────────────────
# Maps to: INTERSWITCH_PROD_URL env var
resource "aws_secretsmanager_secret" "interswitch_base_url" {
  name                    = "${local.prefix}/interswitch-base-url"
  description             = "Interswitch NRS production API base URL"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "INTERSWITCH_PROD_URL" })
}

resource "aws_secretsmanager_secret_version" "interswitch_base_url" {
  secret_id     = aws_secretsmanager_secret.interswitch_base_url.id
  secret_string = "https://api.interswitchgroup.com"
  lifecycle { ignore_changes = [secret_string] }
}

# ── REDIS_URL ─────────────────────────────────────────────────────────────────
# Maps to: REDIS_URL env var
# Format:  rediss://:PASSWORD@HOST:6379
resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${local.prefix}/redis-url"
  description             = "Full Redis TLS connection URL"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "REDIS_URL" })
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh after ElastiCache is provisioned"
  lifecycle { ignore_changes = [secret_string] }
}

# ── CAC_API_KEY ───────────────────────────────────────────────────────────────
# Maps to: CAC_API_KEY env var
resource "aws_secretsmanager_secret" "cac_api_key" {
  name                    = "${local.prefix}/cac-api-key"
  description             = "CAC (Corporate Affairs Commission) API bearer token"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "CAC_API_KEY" })
}

resource "aws_secretsmanager_secret_version" "cac_api_key" {
  secret_id     = aws_secretsmanager_secret.cac_api_key.id
  secret_string = "PLACEHOLDER — set with update-secrets.sh"
  lifecycle { ignore_changes = [secret_string] }
}

# ── NRS_API_BASE_URL ──────────────────────────────────────────────────────────
# Maps to: NRS_API_BASE_URL env var (or INTERSWITCH_PROD_URL in the adapter)
resource "aws_secretsmanager_secret" "nrs_api_base_url" {
  name                    = "${local.prefix}/nrs-api-base-url"
  description             = "NRS e-invoicing API base URL (production)"
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { EnvVar = "NRS_API_BASE_URL" })
}

resource "aws_secretsmanager_secret_version" "nrs_api_base_url" {
  secret_id     = aws_secretsmanager_secret.nrs_api_base_url.id
  secret_string = "PLACEHOLDER — confirm URL with NRS/Interswitch before deploying"
  lifecycle { ignore_changes = [secret_string] }
}
