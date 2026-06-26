variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "app_name" {
  description = "Application name used as a prefix for resource naming"
  type        = string
  default     = "securebank"
}
