##############################################################################
# Outputs — secrets module
##############################################################################

output "db_url_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the database connection URL"
  value       = aws_secretsmanager_secret.db_url.arn
}

output "jwt_key_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the JWT RS256 private key"
  value       = aws_secretsmanager_secret.jwt_private_key.arn
}

output "aes_key_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the AES-256-GCM encryption key"
  value       = aws_secretsmanager_secret.aes_key.arn
}

output "sns_topic_arn_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the SNS topic ARN"
  value       = aws_secretsmanager_secret.sns_topic_arn.arn
}

output "secrets_policy_arn" {
  description = "ARN of the IAM policy granting read access to all SecureBank secrets"
  value       = aws_iam_policy.secrets_read.arn
}

output "redis_url_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the Redis connection URL"
  value       = aws_secretsmanager_secret.redis_url.arn
}
