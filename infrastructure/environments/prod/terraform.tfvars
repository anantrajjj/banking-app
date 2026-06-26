aws_region         = "us-east-1"
app_name           = "securebank"
env                = "prod"
vpc_cidr           = "10.0.0.0/16"
db_username        = "securebank_admin"
db_name            = "securebank"
db_instance_class  = "db.m6g.large"
redis_node_type    = "cache.t3.medium"
certificate_domain = "securebank.example.com"
alert_email        = "ops-team@securebank.example.com"
github_branch      = "main"
# Sensitive vars (db_password, redis_auth_token, codestar_connection_arn, github_repo, ecr_registry)
# must be supplied via environment variables or a secrets management solution:
# TF_VAR_db_password, TF_VAR_redis_auth_token, etc.
