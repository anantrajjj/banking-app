bucket         = "securebank-terraform-state"
key            = "dev/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "securebank-terraform-locks"
