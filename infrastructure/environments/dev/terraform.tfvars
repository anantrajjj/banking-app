aws_region         = "ap-south-1"
app_name           = "securebank"
env                = "dev"
vpc_cidr           = "10.1.0.0/16"

# Database
db_username        = "securebank_dev"
db_name            = "securebank_dev"
db_instance_class  = "db.t3.micro"
db_password        = "FILL_IN_BEFORE_DEPLOY"

# Redis
redis_node_type    = "cache.t3.micro"
redis_auth_token   = "FILL_IN_BEFORE_DEPLOY"

# No domain needed — using ALB DNS directly
certificate_domain = ""

# Alerts
alert_email        = "FILL_IN_BEFORE_DEPLOY"

# CI/CD — fill in after creating CodeStar connection
codestar_connection_arn = "FILL_IN_BEFORE_DEPLOY"
github_repo             = "anantrajjj/banking-app"
github_branch           = "main"
ecr_registry            = "759410591287.dkr.ecr.ap-south-1.amazonaws.com"
