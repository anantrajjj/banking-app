##############################################################################
# Variables — secrets module
##############################################################################

variable "app_name" {
  description = "Application name used as a prefix for resource names and secret paths"
  type        = string
  default     = "securebank"
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "ecs_task_role_arn" {
  description = "ARN of the ECS task IAM role that will be granted read access to the secrets"
  type        = string
}
