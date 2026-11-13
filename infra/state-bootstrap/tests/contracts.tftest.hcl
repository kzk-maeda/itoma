mock_provider "aws" {
  override_during = plan
  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::itoma-terraform-state-123456789012"
      id  = "itoma-terraform-state-123456789012"
    }
  }
}

variables {
  aws_account_id = "123456789012"
  bucket_name    = "itoma-terraform-state-123456789012"
}

run "state_is_private_encrypted_and_versioned" {
  command = plan
  assert {
    condition = aws_s3_bucket_public_access_block.state.block_public_acls && (
      aws_s3_bucket_public_access_block.state.block_public_policy &&
      aws_s3_bucket_public_access_block.state.ignore_public_acls &&
      aws_s3_bucket_public_access_block.state.restrict_public_buckets &&
      !aws_s3_bucket.state.force_destroy
    )
    error_message = "State must not be public or force-deletable with its contents."
  }
  assert {
    condition = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled" && (
      one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    )
    error_message = "State must have object versioning and server-side encryption."
  }
  assert {
    condition = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Effect == "Deny" && (
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "Unencrypted transport to the state bucket must be denied."
  }
}

run "reject_invalid_account" {
  command = plan
  variables {
    aws_account_id = "wrong-account"
  }
  expect_failures = [var.aws_account_id]
}

run "reject_invalid_bucket_name" {
  command = plan
  variables {
    bucket_name = "State_Bucket"
  }
  expect_failures = [var.bucket_name]
}
