output "secret_arns" {
  description = "Map of secret name to ARN"
  value = {
    database_url         = aws_secretsmanager_secret.database_url.arn
    jwt_secret           = aws_secretsmanager_secret.jwt_secret.arn
    admin_jwt_secret     = aws_secretsmanager_secret.admin_jwt_secret.arn
    encryption_key       = aws_secretsmanager_secret.encryption_key.arn
    admin_api_key        = aws_secretsmanager_secret.admin_api_key.arn
    jwt_private_key      = aws_secretsmanager_secret.jwt_private_key.arn
    jwt_public_key       = aws_secretsmanager_secret.jwt_public_key.arn
    admin_key_hash       = aws_secretsmanager_secret.admin_key_hash.arn
    aws_ses_key          = aws_secretsmanager_secret.aws_ses_key.arn
    aws_ses_secret       = aws_secretsmanager_secret.aws_ses_secret.arn
    interswitch_base_url = aws_secretsmanager_secret.interswitch_base_url.arn
    redis_url            = aws_secretsmanager_secret.redis_url.arn
    cac_api_key          = aws_secretsmanager_secret.cac_api_key.arn
    nrs_api_base_url     = aws_secretsmanager_secret.nrs_api_base_url.arn
  }
}

output "secret_names" {
  description = "Map of logical name to Secrets Manager secret name (path)"
  value = {
    database_url         = aws_secretsmanager_secret.database_url.name
    jwt_secret           = aws_secretsmanager_secret.jwt_secret.name
    admin_jwt_secret     = aws_secretsmanager_secret.admin_jwt_secret.name
    encryption_key       = aws_secretsmanager_secret.encryption_key.name
    admin_api_key        = aws_secretsmanager_secret.admin_api_key.name
    jwt_private_key      = aws_secretsmanager_secret.jwt_private_key.name
    jwt_public_key       = aws_secretsmanager_secret.jwt_public_key.name
    admin_key_hash       = aws_secretsmanager_secret.admin_key_hash.name
    aws_ses_key          = aws_secretsmanager_secret.aws_ses_key.name
    aws_ses_secret       = aws_secretsmanager_secret.aws_ses_secret.name
    interswitch_base_url = aws_secretsmanager_secret.interswitch_base_url.name
    redis_url            = aws_secretsmanager_secret.redis_url.name
    cac_api_key          = aws_secretsmanager_secret.cac_api_key.name
    nrs_api_base_url     = aws_secretsmanager_secret.nrs_api_base_url.name
  }
}
