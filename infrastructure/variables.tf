################################################################################
# Root Module — Variables
################################################################################

variable "aws_region" {
  description = "AWS region to deploy all resources into"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Application name used as a prefix/tag for all resources"
  type        = string
  default     = "securebank"
}

variable "env" {
  description = "Deployment environment (e.g. dev, prod)"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_username" {
  description = "Master username for the RDS PostgreSQL instance"
  type        = string
}

variable "db_password" {
  description = "Master password for the RDS PostgreSQL instance"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "Name of the initial database created in the RDS instance"
  type        = string
  default     = "securebank"
}

variable "db_instance_class" {
  description = "RDS instance class (e.g. db.t3.medium, db.m6g.large)"
  type        = string
  default     = "db.t3.medium"
}

variable "redis_node_type" {
  description = "ElastiCache node type for the Redis cluster (e.g. cache.t3.micro)"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_auth_token" {
  description = "AUTH token (password) for Redis in-transit encryption"
  type        = string
  sensitive   = true
}

variable "certificate_domain" {
  default     = ""
  description = "Domain name for the ACM TLS certificate attached to the ALB (e.g. securebank.example.com)"
  type        = string
}

variable "alert_email" {
  description = "Email address for CloudWatch / SNS operational alerts"
  type        = string
}

variable "codestar_connection_arn" {
  description = "ARN of the AWS CodeStar connection used by CodePipeline to access GitHub"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format (e.g. myorg/banking-app-kiro)"
  type        = string
}

variable "github_branch" {
  description = "GitHub branch that triggers the CI/CD pipeline"
  type        = string
  default     = "main"
}

variable "ecr_registry" {
  description = "ECR registry URL (e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com)"
  type        = string
}
