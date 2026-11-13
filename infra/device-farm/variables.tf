variable "aws_account_id" {
  description = "AWS account that owns this infrastructure; also guards provider account selection."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "name" {
  description = "Name prefix for the project, device pool and GitHub execution role."
  type        = string
  default     = "itoma-e2e"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,39}$", var.name))
    error_message = "name must contain 1-40 lowercase letters, digits or hyphens."
  }
}

variable "device_arns" {
  description = "Exact public iOS 18+ catalogue device ARNs. Runtime checks fleet/OS/compatibility again."
  type        = set(string)
  nullable    = false
  validation {
    condition = length(var.device_arns) >= 1 && length(var.device_arns) <= 3 && alltrue([
      for arn in var.device_arns : can(regex("^arn:aws:devicefarm:us-west-2::device:[A-Za-z0-9_-]+$", arn))
    ])
    error_message = "Choose 1-3 catalogue device ARNs in us-west-2."
  }
}

variable "github_repository" {
  description = "Only this owner/repository may assume the runtime role."
  type        = string
  default     = "kzk-maeda/itoma"
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be an exact owner/repository, without wildcards."
  }
}

variable "github_branches" {
  description = "Exact branches allowed to run the workflow. No PR, tag, environment or wildcard subjects."
  type        = set(string)
  default     = ["main"]
  nullable    = false
  validation {
    condition = length(var.github_branches) > 0 && alltrue([
      for branch in var.github_branches : can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*$", branch))
    ])
    error_message = "Use explicit branch names without wildcards or colons."
  }
}

variable "create_github_oidc_provider" {
  description = "False reuses the account's existing GitHub OIDC provider; true creates it when absent."
  type        = bool
  default     = false
}

variable "tags" {
  type        = map(string)
  description = "Additional resource tags. Ownership tags are fixed by this module."
  default     = {}
}
