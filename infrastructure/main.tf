terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.env
      ManagedBy   = "Terraform"
    }
  }
}

module "networking" {
  source   = "./modules/networking"
  app_name = var.app_name
  env      = var.env
  vpc_cidr = var.vpc_cidr
}

module "ecr" {
  source             = "./modules/ecr"
  app_name           = var.app_name
  env                = var.env
  execution_role_arn = module.ecs.execution_role_arn
  depends_on         = [module.ecs]
}

module "secrets" {
  source            = "./modules/secrets"
  app_name          = var.app_name
  env               = var.env
  ecs_task_role_arn = module.ecs.task_role_arn
  depends_on        = [module.ecs]
}

module "rds" {
  source                 = "./modules/rds"
  app_name               = var.app_name
  env                    = var.env
  isolated_db_subnet_ids = module.networking.isolated_db_subnet_ids
  sg_rds_id              = module.networking.sg_rds_id
  db_username            = var.db_username
  db_password            = var.db_password
  db_name                = var.db_name
  db_instance_class      = var.db_instance_class
  depends_on             = [module.networking]
}

module "elasticache" {
  source                 = "./modules/elasticache"
  app_name               = var.app_name
  env                    = var.env
  private_app_subnet_ids = module.networking.private_app_subnet_ids
  sg_api_id              = module.networking.sg_api_id
  vpc_id                 = module.networking.vpc_id
  redis_node_type        = var.redis_node_type
  redis_auth_token       = var.redis_auth_token
  depends_on             = [module.networking]
}

module "alb" {
  source             = "./modules/alb"
  app_name           = var.app_name
  env                = var.env
  sg_alb_id          = module.networking.sg_alb_id
  public_subnet_ids  = module.networking.public_subnet_ids
  certificate_domain = var.certificate_domain
  vpc_id             = module.networking.vpc_id
  depends_on         = [module.networking]
}

module "ecs" {
  source                 = "./modules/ecs"
  app_name               = var.app_name
  env                    = var.env
  private_app_subnet_ids = module.networking.private_app_subnet_ids
  sg_frontend_id         = module.networking.sg_frontend_id
  sg_api_id              = module.networking.sg_api_id
  frontend_image         = "${module.ecr.frontend_ecr_url}:latest"
  api_image              = "${module.ecr.api_ecr_url}:latest"
  frontend_tg_arn        = module.alb.frontend_target_group_arn
  api_tg_arn             = module.alb.api_target_group_arn
  secret_arns = {
    db_url          = module.secrets.db_url_secret_arn
    jwt_private_key = module.secrets.jwt_key_secret_arn
    aes_key         = module.secrets.aes_key_secret_arn
    redis_url       = module.secrets.redis_url_secret_arn
  }
  sns_topic_arn = module.monitoring.sns_topic_arn
  depends_on    = [module.networking, module.alb, module.ecr, module.secrets, module.monitoring]
}

module "monitoring" {
  source           = "./modules/monitoring"
  app_name         = var.app_name
  env              = var.env
  alert_email      = var.alert_email
  alb_arn_suffix   = module.alb.alb_arn
  rds_instance_id  = module.rds.db_instance_id
  ecs_cluster_name = module.ecs.ecs_cluster_id
  api_service_name = module.ecs.api_service_name
  depends_on       = [module.alb, module.rds, module.ecs]
}

module "cicd" {
  source                  = "./modules/cicd"
  app_name                = var.app_name
  env                     = var.env
  codestar_connection_arn = var.codestar_connection_arn
  github_repo             = var.github_repo
  github_branch           = var.github_branch
  frontend_ecr_name       = "${var.app_name}-frontend"
  api_ecr_name            = "${var.app_name}-api"
  ecr_registry            = var.ecr_registry
  ecs_cluster_name        = module.ecs.ecs_cluster_id
  frontend_service_name   = module.ecs.frontend_service_name
  api_service_name        = module.ecs.api_service_name
  secret_arns             = [module.secrets.db_url_secret_arn, module.secrets.jwt_key_secret_arn, module.secrets.aes_key_secret_arn]
  task_role_arn           = module.ecs.task_role_arn
  execution_role_arn      = module.ecs.execution_role_arn
  depends_on              = [module.ecs, module.ecr, module.secrets]
}
