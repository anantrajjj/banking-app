# ─────────────────────────────────────────────────────────────────────────────
# ECR Repository — Frontend (NGINX + React SPA)
# Requirement 14.5: ECR repositories with image scanning enabled
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "frontend" {
  name                 = "${var.app_name}-frontend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-ecr-frontend"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR Repository — API (Node.js/Express)
# Requirement 14.5: ECR repositories with image scanning enabled
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "api" {
  name                 = "${var.app_name}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-ecr-api"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR Lifecycle Policy — Frontend
# Retain the 10 most recent tagged images; expire older ones automatically
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire tagged images beyond the 10 most recent"
        selection = {
          tagStatus   = "tagged"
          tagPrefixList = ["v"]
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR Lifecycle Policy — API
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire tagged images beyond the 10 most recent"
        selection = {
          tagStatus   = "tagged"
          tagPrefixList = ["v"]
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR Repository Policy — Frontend
# Grants the ECS task execution role pull permissions
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowECSTaskExecutionRolePull"
        Effect = "Allow"
        Principal = {
          AWS = var.execution_role_arn
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR Repository Policy — API
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowECSTaskExecutionRolePull"
        Effect = "Allow"
        Principal = {
          AWS = var.execution_role_arn
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# S3 Bucket — Terraform Remote State
# Requirement 14.5: Encrypted, versioned S3 bucket for Terraform state storage
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "terraform_state" {
  bucket        = "securebank-terraform-state"
  force_destroy = false

  tags = {
    Name        = "securebank-terraform-state"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─────────────────────────────────────────────────────────────────────────────
# DynamoDB Table — Terraform State Locking
# Requirement 14.5: DynamoDB table for Terraform state locking
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "securebank-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name        = "securebank-terraform-locks"
    Environment = var.env
    Project     = var.app_name
  }
}
