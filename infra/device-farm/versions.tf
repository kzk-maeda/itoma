terraform {
  required_version = ">= 1.17.2, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region              = "us-west-2"
  allowed_account_ids = [var.aws_account_id]
}
