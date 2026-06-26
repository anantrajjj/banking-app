terraform {
  backend "s3" {
    bucket         = "securebank-terraform-state"
    key            = "securebank/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "securebank-terraform-locks"
  }
}
