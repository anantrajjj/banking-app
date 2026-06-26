###############################################################################
# CI/CD Module — CodePipeline + CodeBuild
# Requirements: 14.1 (pipeline), 14.2 (build/test stages), 14.3 (Docker/scan),
#               14.4 (ECS rolling deploy)
###############################################################################

# ─────────────────────────────────────────────────────────────────────────────
# S3 Artifact Bucket
# Versioned, AES256-encrypted, public access blocked — stores pipeline
# artifacts between stages.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.app_name}-${var.env}-pipeline-artifacts"
  force_destroy = false

  tags = {
    Name        = "${var.app_name}-${var.env}-pipeline-artifacts"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM Role — CodePipeline
# Requirement 14.1: Pipeline execution role with least-privilege permissions
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "codepipeline" {
  name = "${var.app_name}-${var.env}-codepipeline-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "codepipeline.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "${var.app_name}-${var.env}-codepipeline-role"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_iam_role_policy" "codepipeline" {
  name = "${var.app_name}-${var.env}-codepipeline-policy"
  role = aws_iam_role.codepipeline.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 artifact bucket access
      {
        Sid    = "S3ArtifactAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:GetBucketVersioning"
        ]
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      },
      # CodeStar connection for GitHub source
      {
        Sid    = "CodeStarConnectionUse"
        Effect = "Allow"
        Action = ["codestar-connections:UseConnection"]
        Resource = [var.codestar_connection_arn]
      },
      # CodeBuild integration
      {
        Sid    = "CodeBuildAccess"
        Effect = "Allow"
        Action = [
          "codebuild:StartBuild",
          "codebuild:BatchGetBuilds"
        ]
        Resource = [aws_codebuild_project.build.arn]
      },
      # ECS deploy actions
      {
        Sid    = "ECSDeployAccess"
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService"
        ]
        Resource = ["*"]
      },
      # Allow passing ECS task and execution roles to ECS
      {
        Sid    = "PassRoleToECS"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          var.task_role_arn,
          var.execution_role_arn
        ]
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM Role — CodeBuild
# Requirement 14.2: Build role with ECR push, secrets, and VPC permissions
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "codebuild" {
  name = "${var.app_name}-${var.env}-codebuild-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "codebuild.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "${var.app_name}-${var.env}-codebuild-role"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name = "${var.app_name}-${var.env}-codebuild-policy"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs for build output
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = ["arn:aws:logs:*:*:log-group:/aws/codebuild/${var.app_name}-${var.env}-build*"]
      },
      # S3 artifact bucket read/write
      {
        Sid    = "S3ArtifactAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      },
      # ECR authentication token
      {
        Sid      = "ECRAuthToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
      },
      # ECR push permissions (full push workflow)
      {
        Sid    = "ECRPushAccess"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage"
        ]
        Resource = ["*"]
      },
      # Secrets Manager for integration test credentials
      {
        Sid    = "SecretsManagerAccess"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = var.secret_arns
      },
      # VPC network interface management (for VPC-connected builds)
      {
        Sid    = "VPCNetworkAccess"
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcs",
          "ec2:CreateNetworkInterfacePermission"
        ]
        Resource = ["*"]
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# CodeBuild Project — Build & Test
# Requirement 14.2: lint → unit tests → security scans → Trivy scan
# Requirement 14.3: Docker build, Trivy scan, ECR push with Git SHA tag
# Privileged mode enabled for Docker-in-Docker builds
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_codebuild_project" "build" {
  name          = "${var.app_name}-${var.env}-build"
  description   = "Build, test, scan, and push Docker images for ${var.app_name} (${var.env})"
  build_timeout = 60
  service_role  = aws_iam_role.codebuild.arn

  source {
    type      = "CODEPIPELINE"
    buildspec = "infrastructure/modules/cicd/buildspec.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    # privileged_mode required for Docker daemon access during image builds
    privileged_mode = true

    environment_variable {
      name  = "ECR_REGISTRY"
      value = var.ecr_registry
    }

    environment_variable {
      name  = "FRONTEND_REPO"
      value = var.frontend_ecr_name
    }

    environment_variable {
      name  = "API_REPO"
      value = var.api_ecr_name
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name  = "/aws/codebuild/${var.app_name}-${var.env}-build"
      stream_name = "build-log"
    }
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-codebuild"
    Environment = var.env
    Project     = var.app_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# CodePipeline
# Requirement 14.1: Source → Build → Deploy Frontend → Deploy API
# Stages halt on failure; images tagged with Git SHA (CODEBUILD_RESOLVED_SOURCE_VERSION)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_codepipeline" "this" {
  name     = "${var.app_name}-${var.env}-pipeline"
  role_arn = aws_iam_role.codepipeline.arn

  artifact_store {
    location = aws_s3_bucket.artifacts.bucket
    type     = "S3"
  }

  # ── Stage 1: Source ──────────────────────────────────────────────────────
  # Polls the GitHub repository via CodeStar connection; outputs SourceArtifact
  stage {
    name = "Source"

    action {
      name             = "GitHub_Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["SourceArtifact"]

      configuration = {
        ConnectionArn        = var.codestar_connection_arn
        FullRepositoryId     = var.github_repo
        BranchName           = var.github_branch
        OutputArtifactFormat = "CODE_ZIP"
      }
    }
  }

  # ── Stage 2: Build ───────────────────────────────────────────────────────
  # Runs lint, unit tests, Trivy scans, Docker build + push.
  # Pipeline halts here on any non-zero exit from buildspec phases.
  stage {
    name = "Build"

    action {
      name             = "Build_Test_Scan_Push"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["SourceArtifact"]
      output_artifacts = ["BuildArtifact"]

      configuration = {
        ProjectName = aws_codebuild_project.build.name
      }
    }
  }

  # ── Stage 3: Deploy Frontend ─────────────────────────────────────────────
  # Rolling ECS deploy for the NGINX + React SPA service using the
  # frontend-imagedefinitions.json produced in the Build stage
  stage {
    name = "Deploy_Frontend"

    action {
      name            = "Deploy_Frontend_ECS"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      version         = "1"
      input_artifacts = ["BuildArtifact"]

      configuration = {
        ClusterName = var.ecs_cluster_name
        ServiceName = var.frontend_service_name
        FileName    = "frontend-imagedefinitions.json"
      }
    }
  }

  # ── Stage 4: Deploy API ──────────────────────────────────────────────────
  # Rolling ECS deploy for the Node.js/Express API service using the
  # api-imagedefinitions.json produced in the Build stage
  stage {
    name = "Deploy_API"

    action {
      name            = "Deploy_API_ECS"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      version         = "1"
      input_artifacts = ["BuildArtifact"]

      configuration = {
        ClusterName = var.ecs_cluster_name
        ServiceName = var.api_service_name
        FileName    = "api-imagedefinitions.json"
      }
    }
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-pipeline"
    Environment = var.env
    Project     = var.app_name
  }
}
