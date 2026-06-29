###############################################################################
# ECS Module — Input Variables
###############################################################################

variable "app_name" {
  description = "Application name used as a resource-naming prefix"
  type        = string
  default     = "securebank"
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "private_app_subnet_ids" {
  description = "List of private app subnet IDs in which ECS Fargate tasks will be placed"
  type        = list(string)
}

variable "sg_frontend_id" {
  description = "ID of the security group attached to the frontend ECS tasks"
  type        = string
}

variable "sg_api_id" {
  description = "ID of the security group attached to the API ECS tasks"
  type        = string
}

variable "frontend_image" {
  description = "Full ECR image URI for the frontend container (NGINX + React SPA)"
  type        = string
}

variable "api_image" {
  description = "Full ECR image URI for the API container (Node.js/Express)"
  type        = string
}

variable "frontend_tg_arn" {
  description = "ARN of the ALB target group for the frontend service (port 80)"
  type        = string
}

variable "api_tg_arn" {
  description = "ARN of the ALB target group for the API service (port 3000)"
  type        = string
}

variable "secret_arns" {
  description = "Map of Secrets Manager secret ARNs injected into the API container. Expected keys: db_url, jwt_private_key, aes_key"
  type        = map(string)

  validation {
    condition     = contains(keys(var.secret_arns), "db_url") && contains(keys(var.secret_arns), "jwt_private_key") && contains(keys(var.secret_arns), "aes_key") && contains(keys(var.secret_arns), "redis_url") && contains(keys(var.secret_arns), "sns_topic_arn")
    error_message = "secret_arns must contain keys: db_url, jwt_private_key, aes_key, redis_url, sns_topic_arn"
  }
}

variable "sns_topic_arn" {
  description = "ARN of the SNS topic used for OTP delivery; granted to the ECS task role"
  type        = string
}

variable "frontend_desired_count" {
  description = "Desired number of running frontend Fargate tasks"
  type        = number
  default     = 2
}

variable "api_desired_count" {
  description = "Desired number of running API Fargate tasks"
  type        = number
  default     = 2
}

variable "redis_url" {
  description = "Redis connection URL passed as plain env var to avoid Secrets Manager injection timing issues"
  type        = string
  default     = ""
}

variable "jwt_public_key" {
  description = "JWT RS256 public key passed as plain env var"
  type        = string
  default     = ""
  sensitive   = true
}
