################################################################################
# RDS Module — Outputs
################################################################################

output "db_endpoint" {
  description = "Connection endpoint for the RDS PostgreSQL instance (hostname:port)"
  value       = aws_db_instance.main.endpoint
}

output "db_port" {
  description = "Port on which PostgreSQL accepts connections"
  value       = 5432
}

output "db_name" {
  description = "Name of the initial database inside the RDS instance"
  value       = aws_db_instance.main.db_name
}

output "db_instance_id" {
  description = "RDS instance identifier"
  value       = aws_db_instance.main.identifier
}
