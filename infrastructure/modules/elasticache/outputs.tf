################################################################################
# ElastiCache Module — Outputs
################################################################################

output "redis_primary_endpoint" {
  description = "Primary endpoint address for the Redis replication group (used by the API service)"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  description = "Port on which Redis accepts connections"
  value       = 6379
}

output "redis_replication_group_id" {
  description = "ID of the ElastiCache replication group"
  value       = aws_elasticache_replication_group.redis.id
}
