output "frontend_ecr_url" {
  description = "ECR repository URL for the frontend (NGINX + React SPA) image"
  value       = aws_ecr_repository.frontend.repository_url
}

output "api_ecr_url" {
  description = "ECR repository URL for the API (Node.js/Express) image"
  value       = aws_ecr_repository.api.repository_url
}

output "state_bucket_name" {
  description = "Name of the S3 bucket used for Terraform remote state"
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "Name of the DynamoDB table used for Terraform state locking"
  value       = aws_dynamodb_table.terraform_locks.name
}
