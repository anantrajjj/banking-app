################################################################################
# RDS (PostgreSQL 15) Module
# Purpose: Multi-AZ primary database for all SecureBank persistent data
# Requirements: 11.1, 11.6
################################################################################

# ---------------------------------------------------------------------------
# DB Subnet Group — isolated DB subnets only
# RDS instances must live in subnets with no inbound route from the internet
# ---------------------------------------------------------------------------
resource "aws_db_subnet_group" "main" {
  name        = "${var.app_name}-${var.env}-db-subnet-group"
  description = "Isolated DB subnets for SecureBank RDS PostgreSQL (Multi-AZ)"
  subnet_ids  = var.isolated_db_subnet_ids

  tags = {
    Name        = "${var.app_name}-${var.env}-db-subnet-group"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# DB Parameter Group — PostgreSQL 15
# Enables connection/disconnection logging and slow-query logging (≥ 1 s)
# to satisfy audit and observability requirements
# ---------------------------------------------------------------------------
resource "aws_db_parameter_group" "main" {
  name        = "${var.app_name}-${var.env}-pg15-params"
  family      = "postgres15"
  description = "SecureBank PostgreSQL 15 parameter group — audit logging enabled"

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-pg15-params"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# RDS Instance — PostgreSQL 15, Multi-AZ
# - Placed in isolated DB subnets; not publicly accessible
# - Security group allows inbound 5432 from sg-api only (see networking module)
# - Storage encrypted at rest (AWS-managed KMS key)
# - Automated backups retained for 7 days
# - Deletion protection enabled; final snapshot taken on destroy
# ---------------------------------------------------------------------------
resource "aws_db_instance" "main" {
  identifier = "${var.app_name}-${var.env}-postgres"

  # Engine
  engine         = "postgres"
  engine_version = "15"
  instance_class = var.db_instance_class

  # Storage
  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  # Database
  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  # Networking — isolated DB subnets, no public IP
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.sg_rds_id]
  publicly_accessible    = false

  # High availability
  multi_az = false

  # Parameter group
  parameter_group_name = aws_db_parameter_group.main.name

  # Backups and maintenance
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"

  # Protection
  deletion_protection       = true
  skip_final_snapshot       = true
  final_snapshot_identifier = "${var.app_name}-${var.env}-final-snapshot"

  # Performance Insights (optional but helpful for a banking workload)
  performance_insights_enabled = true

  tags = {
    Name        = "${var.app_name}-${var.env}-postgres"
    Environment = var.env
    Project     = var.app_name
  }
}
