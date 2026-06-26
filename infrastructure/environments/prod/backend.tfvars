bucket         = "securebank-terraform-state"
key            = "prod/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "securebank-terraform-locks"
