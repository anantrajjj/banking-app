###############################################################################
# ECS Module — SecureBank
# Creates: ECS cluster, IAM roles, CloudWatch log groups,
#          Fargate task definitions (frontend + API), ECS services
###############################################################################

# ---------------------------------------------------------------------------
# ECS Cluster (Container Insights enabled)
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = "${var.app_name}-${var.env}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-cluster"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# IAM — Task Execution Role
# Used by the ECS agent to pull images from ECR and push logs to CloudWatch
# ---------------------------------------------------------------------------
resource "aws_iam_role" "task_execution" {
  name = "${var.app_name}-${var.env}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "${var.app_name}-${var.env}-ecs-execution-role"
    Environment = var.env
    Project     = var.app_name
  }
}

# Attach the AWS-managed ECS task execution policy (ECR pull + CW Logs)
resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Execution role also needs Secrets Manager so ECS can inject secrets
# as environment variables before the container starts
resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "${var.app_name}-${var.env}-ecs-execution-secrets-policy"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "SecretsManagerRead"
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ]
      Resource = "arn:aws:secretsmanager:*:*:secret:${var.app_name}/*"
    }]
  })
}

# ---------------------------------------------------------------------------
# IAM — Task Role (app-level; used by the running container process)
# Grants least-privilege access to Secrets Manager, CloudWatch, and SNS
# ---------------------------------------------------------------------------
resource "aws_iam_role" "task" {
  name = "${var.app_name}-${var.env}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "${var.app_name}-${var.env}-ecs-task-role"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_iam_role_policy" "task_custom" {
  name = "${var.app_name}-${var.env}-ecs-task-policy"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Secrets Manager — read the application secrets
      {
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = values(var.secret_arns)
      },
      # CloudWatch — publish custom application metrics
      {
        Sid      = "CloudWatchMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
      },
      # SNS — OTP delivery
      {
        Sid      = "SNSPublish"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = var.sns_topic_arn
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/securebank-frontend"
  retention_in_days = 30

  tags = {
    Name        = "/ecs/securebank-frontend"
    Environment = var.env
    Project     = var.app_name
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/securebank-api"
  retention_in_days = 30

  tags = {
    Name        = "/ecs/securebank-api"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# ECS Task Definition — Frontend (NGINX + React SPA)
# 256 CPU units / 512 MB memory
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.app_name}-${var.env}-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.task_execution.arn

  container_definitions = jsonencode([
    {
      name  = "nginx-react"
      image = var.frontend_image

      portMappings = [
        {
          containerPort = 80
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "frontend"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      essential = true
    }
  ])

  tags = {
    Name        = "${var.app_name}-${var.env}-frontend-task"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# ECS Task Definition — API (Node.js/Express)
# 512 CPU units / 1024 MB memory
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.app_name}-${var.env}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = var.api_image

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      # Secrets injected from Secrets Manager as environment variables
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = var.secret_arns["db_url"]
        },
        {
          name      = "JWT_PRIVATE_KEY"
          valueFrom = var.secret_arns["jwt_private_key"]
        },
        {
          name      = "AES_KEY"
          valueFrom = var.secret_arns["aes_key"]
        },
        {
          name      = "REDIS_URL"
          valueFrom = var.secret_arns["redis_url"]
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = "3000"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      essential = true
    }
  ])

  tags = {
    Name        = "${var.app_name}-${var.env}-api-task"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Data Sources
# ---------------------------------------------------------------------------
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# ECS Service — Frontend
# ---------------------------------------------------------------------------
resource "aws_ecs_service" "frontend" {
  name            = "${var.app_name}-${var.env}-frontend"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.frontend_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.sg_frontend_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.frontend_tg_arn
    container_name   = "nginx-react"
    container_port   = 80
  }

  # Ensure log group and task definition exist before creating the service
  depends_on = [
    aws_cloudwatch_log_group.frontend,
    aws_iam_role_policy_attachment.task_execution_managed
  ]

  tags = {
    Name        = "${var.app_name}-${var.env}-frontend-svc"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# ECS Service — API
# ---------------------------------------------------------------------------
resource "aws_ecs_service" "api" {
  name            = "${var.app_name}-${var.env}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.sg_api_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.api_tg_arn
    container_name   = "api"
    container_port   = 3000
  }

  depends_on = [
    aws_cloudwatch_log_group.api,
    aws_iam_role_policy_attachment.task_execution_managed
  ]

  tags = {
    Name        = "${var.app_name}-${var.env}-api-svc"
    Environment = var.env
    Project     = var.app_name
  }
}
