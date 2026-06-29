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
