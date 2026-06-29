# ─────────────────────────────────────────────────────────────────────────────
# Data Sources
# ─────────────────────────────────────────────────────────────────────────────

data "aws_availability_zones" "available" {
  state = "available"
}

# ─────────────────────────────────────────────────────────────────────────────
# VPC
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "${var.app_name}-${var.env}-vpc"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Public Subnets (ALB) — 10.0.0.0/24 and 10.0.1.0/24
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 0)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = false

  tags = {
    Name        = "${var.app_name}-${var.env}-public-subnet-a"
    Environment = var.env
    Project     = var.app_name
    Tier        = "public"
  }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = false

  tags = {
    Name        = "${var.app_name}-${var.env}-public-subnet-b"
    Environment = var.env
    Project     = var.app_name
    Tier        = "public"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Private App Subnets (ECS) — 10.0.2.0/24 and 10.0.3.0/24
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_subnet" "private_app_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 2)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = false

  tags = {
    Name        = "${var.app_name}-${var.env}-private-app-subnet-a"
    Environment = var.env
    Project     = var.app_name
    Tier        = "private-app"
  }
}

resource "aws_subnet" "private_app_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 3)
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = false

  tags = {
    Name        = "${var.app_name}-${var.env}-private-app-subnet-b"
    Environment = var.env
    Project     = var.app_name
    Tier        = "private-app"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Isolated DB Subnets (RDS) — 10.0.4.0/24 and 10.0.5.0/24
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_subnet" "isolated_db_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 4)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = false

  tags = {
    Name        = "${var.app_name}-${var.env}-isolated-db-subnet-a"
    Environment = var.env
    Project     = var.app_name
    Tier        = "isolated-db"
  }
}

resource "aws_subnet" "isolated_db_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 5)
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = false

  tags = {
    Name        = "${var.app_name}-${var.env}-isolated-db-subnet-b"
    Environment = var.env
    Project     = var.app_name
    Tier        = "isolated-db"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Internet Gateway
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "${var.app_name}-${var.env}-igw"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Elastic IPs for NAT Gateways
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_eip" "nat_a" {
  domain = "vpc"

  tags = {
    Name        = "${var.app_name}-${var.env}-nat-eip-a"
    Environment = var.env
    Project     = var.app_name
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_eip" "nat_b" {
  domain = "vpc"

  tags = {
    Name        = "${var.app_name}-${var.env}-nat-eip-b"
    Environment = var.env
    Project     = var.app_name
  }

  depends_on = [aws_internet_gateway.main]
}

# ─────────────────────────────────────────────────────────────────────────────
# NAT Gateways (one per public subnet for high availability)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_nat_gateway" "nat_a" {
  allocation_id = aws_eip.nat_a.id
  subnet_id     = aws_subnet.public_a.id

  tags = {
    Name        = "${var.app_name}-${var.env}-nat-gw-a"
    Environment = var.env
    Project     = var.app_name
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "nat_b" {
  allocation_id = aws_eip.nat_b.id
  subnet_id     = aws_subnet.public_b.id

  tags = {
    Name        = "${var.app_name}-${var.env}-nat-gw-b"
    Environment = var.env
    Project     = var.app_name
  }

  depends_on = [aws_internet_gateway.main]
}

# ─────────────────────────────────────────────────────────────────────────────
# Route Table — Public (routes 0.0.0.0/0 → IGW)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-public-rt"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# ─────────────────────────────────────────────────────────────────────────────
# Route Tables — Private App (routes 0.0.0.0/0 → NAT GW, per AZ)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_route_table" "private_app_a" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat_a.id
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-private-app-rt-a"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_route_table" "private_app_b" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat_b.id
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-private-app-rt-b"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_route_table_association" "private_app_a" {
  subnet_id      = aws_subnet.private_app_a.id
  route_table_id = aws_route_table.private_app_a.id
}

resource "aws_route_table_association" "private_app_b" {
  subnet_id      = aws_subnet.private_app_b.id
  route_table_id = aws_route_table.private_app_b.id
}

# ─────────────────────────────────────────────────────────────────────────────
# Route Tables — Isolated DB (no 0.0.0.0/0 — no internet access)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_route_table" "isolated_db" {
  vpc_id = aws_vpc.main.id

  # Intentionally no default route — DB subnets have no internet access

  tags = {
    Name        = "${var.app_name}-${var.env}-isolated-db-rt"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_route_table_association" "isolated_db_a" {
  subnet_id      = aws_subnet.isolated_db_a.id
  route_table_id = aws_route_table.isolated_db.id
}

resource "aws_route_table_association" "isolated_db_b" {
  subnet_id      = aws_subnet.isolated_db_b.id
  route_table_id = aws_route_table.isolated_db.id
}

# ─────────────────────────────────────────────────────────────────────────────
# Security Group — ALB (public-facing; inbound 80 and 443 from internet)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "sg_alb" {
  name        = "${var.app_name}-${var.env}-sg-alb"
  description = "ALB security group: inbound HTTP/HTTPS from internet, all outbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Allow HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Allow HTTP from internet (redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-sg-alb"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Security Group — Frontend (NGINX/React SPA on ECS; inbound 80 from ALB SG)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "sg_frontend" {
  name        = "${var.app_name}-${var.env}-sg-frontend"
  description = "Frontend ECS tasks: inbound port 80 from ALB only, all outbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Allow HTTP from ALB security group"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.sg_alb.id]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-sg-frontend"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Security Group — API (Node.js/Express on ECS; inbound 3000 from ALB SG)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "sg_api" {
  name        = "${var.app_name}-${var.env}-sg-api"
  description = "API ECS tasks: inbound port 3000 from ALB only, all outbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Allow API traffic from ALB security group"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.sg_alb.id]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-sg-api"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Security Group — RDS (PostgreSQL; inbound 5432 from sg-api ONLY, no outbound)
# Requirement 11.6: inbound PostgreSQL traffic only from the ECS task SG
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "sg_rds" {
  name        = "${var.app_name}-${var.env}-sg-rds"
  description = "RDS PostgreSQL: inbound 5432 from API security group only, no outbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Allow PostgreSQL from API ECS security group only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.sg_api.id]
  }

  # No egress rules — RDS does not initiate outbound connections

  tags = {
    Name        = "${var.app_name}-${var.env}-sg-rds"
    Environment = var.env
    Project     = var.app_name
  }
}
