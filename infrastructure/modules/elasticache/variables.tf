################################################################################
# ElastiCache Module — Input Variables
################################################################################

variable "private_app_subnet_ids" {
  description = "List of private app subnet IDs where the Redis cluster will be placed"
  type        = list(string)
}

variable "sg_api_id" {
  description = "Security group ID of the API ECS tasks; permitted to reach Redis on port 6379"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC in which the Redis security group is created"
  type        = string
}

variable "redis_node_type" {
  description = "ElastiCache node type for Redis cluster members"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_auth_token" {
  description = "AUTH token for Redis connections (minimum 16 characters, stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "app_name" {
  description = "Application name used as a prefix for all resource names and tags"
  type        = string
  default     = "securebank"
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}
