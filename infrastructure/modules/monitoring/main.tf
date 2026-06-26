# ──────────────────────────────────────────────────────────────
# SNS ALERTS TOPIC
# ──────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.app_name}-${var.env}-alerts"

  tags = {
    Name        = "${var.app_name}-${var.env}-alerts"
    Application = var.app_name
    Environment = var.env
  }
}

resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ──────────────────────────────────────────────────────────────
# CLOUDWATCH LOG GROUPS
# ──────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "ecs_frontend" {
  name              = "/ecs/securebank-frontend"
  retention_in_days = 30

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

resource "aws_cloudwatch_log_group" "ecs_api" {
  name              = "/ecs/securebank-api"
  retention_in_days = 30

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

# ──────────────────────────────────────────────────────────────
# CLOUDWATCH ALARMS
# ──────────────────────────────────────────────────────────────

# 1. API 5xx Error Rate — ALB target 5xx responses
resource "aws_cloudwatch_metric_alarm" "api_5xx_error_rate" {
  alarm_name          = "${var.app_name}-${var.env}-API-5xx-ErrorRate"
  alarm_description   = "Triggers when the number of 5xx responses from the ALB target exceeds 50 in a 5-minute window."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

# 2. API 4xx Spike Rate — ALB target 4xx responses
resource "aws_cloudwatch_metric_alarm" "api_4xx_spike_rate" {
  alarm_name          = "${var.app_name}-${var.env}-API-4xx-SpikeRate"
  alarm_description   = "Triggers when the number of 4xx responses from the ALB target exceeds 500 in a 5-minute window."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_4XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 500
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

# 3. RDS CPU Utilization
resource "aws_cloudwatch_metric_alarm" "rds_cpu_utilization" {
  alarm_name          = "${var.app_name}-${var.env}-RDS-CPUUtilization"
  alarm_description   = "Triggers when RDS CPU utilisation exceeds 80% for 5 consecutive minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

# 4. ECS API Service Memory Utilization
resource "aws_cloudwatch_metric_alarm" "ecs_api_memory_utilization" {
  alarm_name          = "${var.app_name}-${var.env}-ECS-API-MemoryUtilization"
  alarm_description   = "Triggers when the ECS API service memory utilisation exceeds 90% for 5 consecutive minutes."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.api_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

# 5. Failed Login Attempts — custom metric emitted by the auth service
resource "aws_cloudwatch_metric_alarm" "failed_login_attempts" {
  alarm_name          = "${var.app_name}-${var.env}-FailedLoginAttempts"
  alarm_description   = "Triggers when more than 50 failed login attempts are recorded in a 5-minute window, indicating a possible brute-force or credential-stuffing attack."
  namespace           = "securebank/auth"
  metric_name         = "FailedLoginAttempt"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Application = var.app_name
    Environment = var.env
  }
}

# ──────────────────────────────────────────────────────────────
# CLOUDTRAIL — AUDIT TRAIL
# ──────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

# S3 bucket for CloudTrail log storage
resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket        = "${var.app_name}-${var.env}-cloudtrail-logs"
  force_destroy = false

  tags = {
    Name        = "${var.app_name}-${var.env}-cloudtrail-logs"
    Environment = var.env
    Project     = var.app_name
  }
}

# Server-side encryption (AES-256) for CloudTrail log bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block all public access to the CloudTrail log bucket
resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning on the CloudTrail log bucket
resource "aws_s3_bucket_versioning" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Bucket policy granting CloudTrail permission to write logs
resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSCloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.cloudtrail_logs.arn
      },
      {
        Sid       = "AWSCloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.cloudtrail_logs.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

# CloudTrail trail — captures all AWS API calls in the deployment region
resource "aws_cloudtrail" "main" {
  name                          = "${var.app_name}-${var.env}-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = true

  tags = {
    Name        = "${var.app_name}-${var.env}-trail"
    Environment = var.env
    Project     = var.app_name
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail_logs]
}
