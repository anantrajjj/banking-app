output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "List of public subnet IDs (ALB tier)"
  value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

output "private_app_subnet_ids" {
  description = "List of private app subnet IDs (ECS tier)"
  value       = [aws_subnet.private_app_a.id, aws_subnet.private_app_b.id]
}

output "isolated_db_subnet_ids" {
  description = "List of isolated DB subnet IDs (RDS tier)"
  value       = [aws_subnet.isolated_db_a.id, aws_subnet.isolated_db_b.id]
}

output "sg_frontend_id" {
  description = "ID of the frontend ECS security group"
  value       = aws_security_group.sg_frontend.id
}

output "sg_api_id" {
  description = "ID of the API ECS security group"
  value       = aws_security_group.sg_api.id
}

output "sg_rds_id" {
  description = "ID of the RDS security group"
  value       = aws_security_group.sg_rds.id
}

output "sg_alb_id" {
  description = "ID of the ALB security group"
  value       = aws_security_group.sg_alb.id
}
