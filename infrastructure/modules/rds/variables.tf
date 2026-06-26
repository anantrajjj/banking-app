################################################################################
# RDS Module — Input Variables
################################################################################

variable "isolated_db_subnet_ids" {
  description = "List of isolated DB subnet IDs where the RDS instance will be placed (one per AZ for Multi-AZ)"
  type        = list(string)
}

variable "sg_rds_id" {
  description = "Security group ID for the RDS instance; must already allow inbound 5432 from sg-api only"
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class (e.g. db.t3.medium, db.m6g.large)"
  type        = string
  default     = "db.t3.medium"
}

variable "db_username" {
  description = "Master username for the PostgreSQL database"
  type        = string
}

variable "db_password" {
  description = "Master password for the PostgreSQL database — stored in Secrets Manager; never hard-coded"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "Name of the initial database created inside the RDS instance"
  type        = string
  default     = "securebank"
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
