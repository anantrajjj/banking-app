################################################################################
# ElastiCache (Redis 7) Module
# Purpose: Token revocation list, OTP store, rate-limit counters, session store
################################################################################

# ---------------------------------------------------------------------------
# Security Group — Redis
# Inbound: port 6379 from the API ECS security group only
# Outbound: none required (ElastiCache is a managed service)
# ---------------------------------------------------------------------------
resource "aws_security_group" "sg_redis" {
  name        = "${var.app_name}-${var.env}-redis-sg"
  description = "Allow Redis traffic from API ECS tasks only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from API ECS SG"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.sg_api_id]
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-redis-sg"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Subnet Group — private app subnets (not DB subnets)
# Redis lives alongside the ECS API tasks in the private app tier
# ---------------------------------------------------------------------------
resource "aws_elasticache_subnet_group" "redis" {
  name        = "${var.app_name}-${var.env}-redis-subnet-group"
  description = "Private app subnets for SecureBank Redis cluster"
  subnet_ids  = var.private_app_subnet_ids

  tags = {
    Name        = "${var.app_name}-${var.env}-redis-subnet-group"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# ElastiCache Replication Group — Redis 7
# - 2 nodes across AZs for HA with automatic failover
# - Encryption at rest and in transit (TLS)
# - AUTH token required for all connections
# ---------------------------------------------------------------------------
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.app_name}-${var.env}-redis"
  description          = "SecureBank Redis for token/session store"

  engine         = "redis"
  engine_version = "7.0"
  node_type      = var.redis_node_type

  num_cache_clusters         = 2
  automatic_failover_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.sg_redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token

  apply_immediately = false

  tags = {
    Name        = "${var.app_name}-${var.env}-redis"
    Environment = var.env
    Project     = var.app_name
  }
}
