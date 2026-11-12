variable "aws_account_id" {
  description = "Expected account; the AWS provider rejects a different account."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "bucket_name" {
  description = "Globally unique state bucket name, containing lowercase letters, digits and hyphens."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "Use 3-63 lowercase letters, digits or hyphens, with alphanumeric ends."
  }
}
