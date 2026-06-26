###############################################################################
# ALB Module — Outputs
###############################################################################

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.this.arn
}

output "alb_dns_name" {
  description = "DNS name of the ALB (use this in Route 53 alias records)"
  value       = aws_lb.this.dns_name
}

output "frontend_target_group_arn" {
  description = "ARN of the frontend (NGINX/React) target group"
  value       = aws_lb_target_group.frontend.arn
}

output "api_target_group_arn" {
  description = "ARN of the Node.js API target group"
  value       = aws_lb_target_group.api.arn
}

output "waf_web_acl_arn" {
  description = "ARN of the WAFv2 Web ACL attached to the ALB"
  value       = aws_wafv2_web_acl.this.arn
}
