locals {
  tags = merge(var.tags, {
    Application = "itoma"
    Component   = "e2e"
    ManagedBy   = "terraform"
  })
  github_oidc_arn = "arn:aws:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com"
  oidc_provider_arn = var.create_github_oidc_provider ? (
    aws_iam_openid_connect_provider.github[0].arn
  ) : data.aws_iam_openid_connect_provider.github[0].arn

  runtime_policy = {
    Version = "2012-10-17"
    Statement = [{
      Sid    = "DeviceFarmRuntimeWithinOneProject"
      Effect = "Allow"
      Action = [
        "devicefarm:CreateUpload", "devicefarm:GetUpload", "devicefarm:DeleteUpload",
        "devicefarm:GetDevicePool", "devicefarm:GetDevicePoolCompatibility",
        "devicefarm:ScheduleRun", "devicefarm:ListRuns", "devicefarm:GetRun", "devicefarm:StopRun",
        "devicefarm:ListJobs", "devicefarm:ListSuites", "devicefarm:ListTests", "devicefarm:ListArtifacts",
      ]
      Resource = concat(
        [aws_devicefarm_project.e2e.arn, aws_devicefarm_device_pool.ios.arn],
        [for kind in ["upload", "run", "job", "suite", "test"] :
          "${replace(aws_devicefarm_project.e2e.arn, ":project:", ":${kind}:")}/*"
        ],
      )
    }]
  }
}

resource "aws_devicefarm_project" "e2e" {
  name                        = var.name
  default_job_timeout_minutes = 10
  tags                        = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_devicefarm_device_pool" "ios" {
  name        = "${var.name}-ios-public"
  description = "Explicit public iOS devices for the manually triggered ITOMA UI smoke."
  project_arn = aws_devicefarm_project.e2e.arn
  max_devices = length(var.device_arns)
  tags        = local.tags

  rule {
    attribute = "ARN"
    operator  = "IN"
    value     = jsonencode(sort(tolist(var.device_arns)))
  }
  rule {
    attribute = "PLATFORM"
    operator  = "EQUALS"
    value     = jsonencode("IOS")
  }
  rule {
    attribute = "FLEET_TYPE"
    operator  = "EQUALS"
    value     = jsonencode("PUBLIC")
  }
  rule {
    attribute = "OS_VERSION"
    operator  = "GREATER_THAN_OR_EQUALS"
    value     = jsonencode("18")
  }
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  arn   = local.github_oidc_arn

  lifecycle {
    postcondition {
      condition = contains(self.client_id_list, "sts.amazonaws.com") && (
        trimprefix(self.url, "https://") == "token.actions.githubusercontent.com"
      )
      error_message = "The existing provider must be GitHub Actions OIDC with the STS audience."
    }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_iam_role" "runtime" {
  name                 = "${var.name}-github-runtime"
  max_session_duration = 3600
  tags                 = local.tags
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = local.oidc_provider_arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            for branch in sort(tolist(var.github_branches)) :
            "repo:${var.github_repository}:ref:refs/heads/${branch}"
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "runtime" {
  name   = "device-farm-runtime"
  role   = aws_iam_role.runtime.id
  policy = jsonencode(local.runtime_policy)
}
