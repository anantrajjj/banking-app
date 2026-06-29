###############################################################################
# ALB Module — SecureBank (HTTP-only, demo-friendly)
# No certificate required — exposes plain HTTP on port 80
# Routes: /v1/* → API target group | /* → Frontend target group
###############################################################################

# ---------------------------------------------------------------------------
# Application Load Balancer
# ---------------------------------------------------------------------------
resource "aws_lb" "this" {
  name               = "${var.app_name}-${var.env}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.sg_alb_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false

  tags = {
    Name        = "${var.app_name}-${var.env}-alb"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Target Group — Frontend (Nginx on port 80)
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
    path                = "/health"
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
# HTTP Listener (port 80)
# Default: forward to frontend. Path rules override for /v1/*
# ---------------------------------------------------------------------------
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # Default → frontend (catches /*, /login, /dashboard, etc.)
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }

  tags = {
    Name        = "${var.app_name}-${var.env}-http-listener"
    Environment = var.env
    Project     = var.app_name
  }
}

# ---------------------------------------------------------------------------
# Listener Rule — /v1/* → API target group (priority 10)
# This must be higher priority than the default frontend catch-all
# ---------------------------------------------------------------------------
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/v1/*"]
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
# WAF v2 Web ACL (REGIONAL — attached to ALB)
# Kept even for demo — protects against SQLi and XSS at no extra setup cost
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "this" {
  name  = "${var.app_name}-${var.env}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

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

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
