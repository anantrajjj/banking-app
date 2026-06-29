aws_region         = "ap-south-1"
app_name           = "securebank"
env                = "dev"
vpc_cidr           = "10.1.0.0/16"

# Database
db_username        = "securebank_dev"
db_name            = "securebank_dev"
db_instance_class  = "db.t3.micro"
db_password        = "Demo1234!Secure"

# Redis
redis_node_type    = "cache.t3.micro"
redis_auth_token   = "Demo1234!RedisToken"

# No domain needed — using ALB DNS directly
certificate_domain = ""

# Alerts
alert_email        = "dhimanarjun25@gmail.com"

# CI/CD
codestar_connection_arn = "arn:aws:codeconnections:ap-south-1:759410591287:connection/a2bdedb2-bedf-4305-aa0a-fce28e9217db"
github_repo             = "anantrajjj/banking-app"
github_branch           = "main"
ecr_registry            = "759410591287.dkr.ecr.ap-south-1.amazonaws.com"
