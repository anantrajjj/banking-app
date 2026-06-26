################################################################################
# Root Module — Outputs
################################################################################

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer (use in Route 53 alias records)"
  value       = module.alb.alb_dns_name
}

output "frontend_ecr_url" {
  description = "ECR repository URL for the frontend (NGINX + React SPA) image"
  value       = module.ecr.frontend_ecr_url
}

output "api_ecr_url" {
  description = "ECR repository URL for the API (Node.js/Express) image"
  value       = module.ecr.api_ecr_url
}

output "rds_endpoint" {
  description = "Connection endpoint for the RDS PostgreSQL instance (hostname:port)"
  value       = module.rds.db_endpoint
}

output "redis_endpoint" {
  description = "Primary endpoint address for the Redis ElastiCache replication group"
  value       = module.elasticache.redis_primary_endpoint
}

output "ecs_cluster_id" {
  description = "ID of the ECS cluster running frontend and API services"
  value       = module.ecs.ecs_cluster_id
}

output "pipeline_name" {
  description = "Name of the CodePipeline CI/CD pipeline"
  value       = module.cicd.pipeline_name
}

output "sns_alerts_arn" {
  description = "ARN of the SNS topic used for operational alerts"
  value       = module.monitoring.sns_topic_arn
}

output "cloudtrail_trail_arn" {
  description = "ARN of the CloudTrail trail for audit logging"
  value       = module.monitoring.cloudtrail_trail_arn
}
