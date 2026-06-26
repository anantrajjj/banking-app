variable "app_name" {
  description = "Application name used as a prefix for resource naming"
  type        = string
  default     = "securebank"
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "alert_email" {
  description = "Email address that receives SNS alert notifications"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ARN suffix of the Application Load Balancer (used in ALB CloudWatch dimensions)"
  type        = string
}

variable "rds_instance_id" {
  description = "RDS DB instance identifier (used in RDS CloudWatch dimensions)"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster (used in ECS CloudWatch dimensions)"
  type        = string
}

variable "api_service_name" {
  description = "Name of the ECS service running the API (used in ECS CloudWatch dimensions)"
  type        = string
}
