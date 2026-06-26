###############################################################################
# ALB Module — SecureBank
# Creates: ALB, ACM cert lookup, HTTPS/HTTP listeners, target groups,
#          listener rules, WAF v2 Web ACL (SQLi + XSS), WAF association
###############################################################################

# ---------------------------------------------------------------------------
# ACM Certificate (data source — must already be ISSUED in ACM)
# ---------------------------------------------------------------------------
data "aws_acm_certificate" "this" {
  domain      = var.certificate_domain
  statuses    = ["ISSUED"]
  most_recent = true
}

# ---------------------------------------------------------------------------
# Application Load Balancer
# ---------------------------------------------------------------------------
resource "aws_lb" "this" {
  name               = "${var.app_name}-${var.env}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.sg_alb_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.env == "prod" ? true : false

  tags = {
    Name        = "${var.app_name}-${var.env}-alb"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Target Group — Frontend (NGINX on port 80)
# ---------------------------------------------------------------------------
resource "aws_lb_target_group" "frontend" {
  name        = "${var.app_name}-${var.env}-frontend-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-frontend-tg"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Target Group — API (Node.js on port 3000)
# ---------------------------------------------------------------------------
resource "aws_lb_target_group" "api" {
  name        = "${var.app_name}-${var.env}-api-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/v1/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-api-tg"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# HTTPS Listener (port 443)
# Default action: fixed 404 response — path rules below handle real traffic
# TLS policy enforces TLS 1.2 minimum
# ---------------------------------------------------------------------------
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = data.aws_acm_certificate.this.arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Not Found\"}"
      status_code  = "404"
    }
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-https-listener"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# HTTP Listener (port 80) — 301 redirect to HTTPS
# ---------------------------------------------------------------------------
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-http-redirect-listener"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Listener Rule — /api/* → API target group (priority 10)
# ---------------------------------------------------------------------------
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-api-rule"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Listener Rule — /* → Frontend target group (priority 100)
# ---------------------------------------------------------------------------
resource "aws_lb_listener_rule" "frontend" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-frontend-rule"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# WAF v2 Web ACL (REGIONAL — attached to ALB)
# Rule 1: AWS Managed SQLi rule group
# Rule 2: AWS Common Rule Set (covers XSS and other OWASP Top 10)
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "this" {
  name  = "${var.app_name}-${var.env}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Priority 1 — SQL Injection protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-${var.env}-SQLiRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # Priority 2 — Common Rule Set (includes XSS protections)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-${var.env}-CommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.app_name}-${var.env}-waf"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-waf"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# WAF Association — attach Web ACL to the ALB
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
