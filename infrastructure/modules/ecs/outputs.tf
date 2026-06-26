###############################################################################
# ECS Module — Outputs
###############################################################################

output "ecs_cluster_id" {
  description = "ID of the ECS cluster"
  value       = aws_ecs_cluster.this.id
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.this.arn
}

output "frontend_service_name" {
  description = "Name of the ECS frontend service"
  value       = aws_ecs_service.frontend.name
}

output "api_service_name" {
  description = "Name of the ECS API service"
  value       = aws_ecs_service.api.name
}

output "task_role_arn" {
  description = "ARN of the ECS task role (app-level; has Secrets Manager, CloudWatch, SNS permissions)"
  value       = aws_iam_role.task.arn
}

output "execution_role_arn" {
  description = "ARN of the ECS task execution role (ECR pull + CloudWatch Logs write)"
  value       = aws_iam_role.task_execution.arn
}
