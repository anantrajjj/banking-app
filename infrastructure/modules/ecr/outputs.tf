output "frontend_ecr_url" {
  description = "ECR repository URL for the frontend (NGINX + React SPA) image"
  value       = aws_ecr_repository.frontend.repository_url
}

output "api_ecr_url" {
  description = "ECR repository URL for the API (Node.js/Express) image"
  value       = aws_ecr_repository.api.repository_url
}

