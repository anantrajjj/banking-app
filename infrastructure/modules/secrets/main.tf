##############################################################################
# Secrets Manager — SecureBank
# Creates secrets for DB URL, JWT private key, AES-256 key, and SNS topic ARN.
# IAM policy grants GetSecretValue + DescribeSecret to the ECS task role only.
##############################################################################

locals {
  common_tags = {
    Name        = "${var.app_name}-${var.env}"
    Environment = var.env
    Project     = var.app_name
  }
}

# ── DB URL ────────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "db_url" {
  name        = "${var.app_name}/db-url"
  description = "PostgreSQL connection URL for the ${var.app_name} application (${var.env})"

  tags = merge(local.common_tags, {
    Name = "${var.app_name}-${var.env}-db-url"
  })
}

resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id     = aws_secretsmanager_secret.db_url.id
  secret_string = jsonencode({ placeholder = "REPLACE_BEFORE_DEPLOY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── JWT Private Key ───────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "jwt_private_key" {
  name        = "${var.app_name}/jwt-private-key"
  description = "RS256 private key used to sign JWTs for the ${var.app_name} application (${var.env})"

  tags = merge(local.common_tags, {
    Name = "${var.app_name}-${var.env}-jwt-private-key"
  })
}

resource "aws_secretsmanager_secret_version" "jwt_private_key" {
  secret_id     = aws_secretsmanager_secret.jwt_private_key.id
  secret_string = jsonencode({ placeholder = "REPLACE_BEFORE_DEPLOY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── AES-256 Key ───────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "aes_key" {
  name        = "${var.app_name}/aes-key"
  description = "AES-256-GCM encryption key for PII fields in the ${var.app_name} application (${var.env})"

  tags = merge(local.common_tags, {
    Name = "${var.app_name}-${var.env}-aes-key"
  })
}

resource "aws_secretsmanager_secret_version" "aes_key" {
  secret_id     = aws_secretsmanager_secret.aes_key.id
  secret_string = jsonencode({ placeholder = "REPLACE_BEFORE_DEPLOY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── SNS Topic ARN ─────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "sns_topic_arn" {
  name        = "${var.app_name}/sns-topic-arn"
  description = "SNS topic ARN used for OTP delivery in the ${var.app_name} application (${var.env})"

  tags = merge(local.common_tags, {
    Name = "${var.app_name}-${var.env}-sns-topic-arn"
  })
}

resource "aws_secretsmanager_secret_version" "sns_topic_arn" {
  secret_id     = aws_secretsmanager_secret.sns_topic_arn.id
  secret_string = jsonencode({ placeholder = "REPLACE_BEFORE_DEPLOY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── IAM Policy: ECS task role read-only access to all 4 secrets ───────────────

resource "aws_iam_policy" "secrets_read" {
  name        = "${var.app_name}-${var.env}-secrets-read-policy"
  description = "Allow the ECS task role to read ${var.app_name} secrets from Secrets Manager (${var.env})"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.db_url.arn,
          aws_secretsmanager_secret.jwt_private_key.arn,
          aws_secretsmanager_secret.aes_key.arn,
          aws_secretsmanager_secret.sns_topic_arn.arn
        ]
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${var.app_name}-${var.env}-secrets-read-policy"
  })
}

# ── Attach policy to ECS task role ────────────────────────────────────────────

resource "aws_iam_role_policy_attachment" "ecs_task_secrets" {
  role       = var.ecs_task_role_arn
  policy_arn = aws_iam_policy.secrets_read.arn
}
