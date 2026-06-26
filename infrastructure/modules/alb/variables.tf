###############################################################################
# ALB Module — Input Variables
###############################################################################

variable "sg_alb_id" {
  description = "ID of the security group to attach to the ALB (allows 80/443 inbound from internet)"
  type        = string
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs across which the ALB will be deployed (minimum two AZs)"
  type        = list(string)
}

variable "certificate_domain" {
  description = "Domain name used to look up the ACM certificate (e.g. securebank.example.com). Certificate must already exist with status ISSUED."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC in which target groups are created"
  type        = string
}

variable "app_name" {
  description = "Application name used as a resource-naming prefix"
  type        = string
  default     = "securebank"
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging, dev). Deletion protection is enabled automatically when this is 'prod'."
  type        = string
  default     = "prod"
}
