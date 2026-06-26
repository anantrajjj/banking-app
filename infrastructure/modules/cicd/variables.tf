###############################################################################
# CI/CD Module — Variables
# Requirements: 14.1, 14.2, 14.3, 14.4
###############################################################################

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

variable "codestar_connection_arn" {
  description = "ARN of the CodeStar connection used to authenticate with GitHub"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository in 'org/repo' format (e.g. 'org/securebank')"
  type        = string
}

variable "github_branch" {
  description = "Git branch to track for pipeline triggers"
  type        = string
  default     = "main"
}

variable "frontend_ecr_name" {
  description = "Name of the ECR repository for the frontend (NGINX + React SPA) image"
  type        = string
}

variable "api_ecr_name" {
  description = "Name of the ECR repository for the API (Node.js/Express) image"
  type        = string
}

variable "ecr_registry" {
  description = "AWS account ECR registry URL (e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com)"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster where services are deployed"
  type        = string
}

variable "frontend_service_name" {
  description = "Name of the ECS frontend service"
  type        = string
}

variable "api_service_name" {
  description = "Name of the ECS API service"
  type        = string
}

variable "secret_arns" {
  description = "List of Secrets Manager ARNs that CodeBuild needs access to (e.g. for integration tests)"
  type        = list(string)
}

variable "task_role_arn" {
  description = "ARN of the ECS task role (used in iam:PassRole permission for CodePipeline)"
  type        = string
}

variable "execution_role_arn" {
  description = "ARN of the ECS task execution role (used in iam:PassRole permission for CodePipeline)"
  type        = string
}
