output "primary_endpoint" {
  description = "Redis primary endpoint address"
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_cluster.main.cache_nodes[0].port
}

output "redis_url" {
  description = "Full Redis connection URL (rediss:// with TLS)"
  value       = "rediss://:${var.auth_token}@${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
  sensitive   = true
}
