###############################################################################
# CI/CD Module — Outputs
###############################################################################

output "pipeline_arn" {
  description = "ARN of the CodePipeline pipeline"
  value       = aws_codepipeline.this.arn
}

output "pipeline_name" {
  description = "Name of the CodePipeline pipeline"
  value       = aws_codepipeline.this.name
}

output "codebuild_project_name" {
  description = "Name of the CodeBuild build-and-test project"
  value       = aws_codebuild_project.build.name
}

output "artifact_bucket_name" {
  description = "Name of the S3 bucket used to store pipeline artifacts"
  value       = aws_s3_bucket.artifacts.bucket
}
