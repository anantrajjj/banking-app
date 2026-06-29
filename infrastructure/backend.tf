terraform {
  backend "s3" {
    bucket         = "securebank-tf-state-759410591287"
    key            = "securebank/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "securebank-terraform-locks"
  }
}
