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

variable "execution_role_arn" {
  description = "ARN of the ECS task execution IAM role allowed to pull images from ECR"
  type        = string
}
