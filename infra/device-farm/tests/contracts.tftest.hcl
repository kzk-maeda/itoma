mock_provider "aws" {
  override_during = plan

  mock_resource "aws_devicefarm_project" {
    defaults = {
      arn = "arn:aws:devicefarm:us-west-2:123456789012:project:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    }
  }
  mock_resource "aws_devicefarm_device_pool" {
    defaults = {
      arn = "arn:aws:devicefarm:us-west-2:123456789012:devicepool:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = {
      arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    }
  }
  mock_data "aws_iam_openid_connect_provider" {
    defaults = {
      arn            = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      url            = "token.actions.githubusercontent.com"
      client_id_list = ["sts.amazonaws.com"]
    }
  }
}

variables {
  aws_account_id = "123456789012"
  device_arns    = ["arn:aws:devicefarm:us-west-2::device:EXAMPLE1"]
}

run "single_device_and_shared_oidc" {
  command = plan
  assert {
    condition = aws_devicefarm_project.e2e.default_job_timeout_minutes == 10 && (
      aws_devicefarm_device_pool.ios.max_devices == 1 &&
      one([for rule in aws_devicefarm_device_pool.ios.rule : rule if rule.attribute == "ARN"]).operator == "IN" &&
      jsondecode(one([for rule in aws_devicefarm_device_pool.ios.rule : rule if rule.attribute == "ARN"]).value) == ["arn:aws:devicefarm:us-west-2::device:EXAMPLE1"]
    )
    error_message = "The default run must be bounded and use only the explicitly selected device."
  }
  assert {
    condition = alltrue([
      for attribute, value in { PLATFORM = "IOS", FLEET_TYPE = "PUBLIC", OS_VERSION = "18" } :
      jsondecode(one([for rule in aws_devicefarm_device_pool.ios.rule : rule if rule.attribute == attribute]).value) == value &&
      one([for rule in aws_devicefarm_device_pool.ios.rule : rule if rule.attribute == attribute]).operator == (attribute == "OS_VERSION" ? "GREATER_THAN_OR_EQUALS" : "EQUALS")
    ])
    error_message = "The pool itself must filter for public iOS 18+ devices."
  }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0 && length(data.aws_iam_openid_connect_provider.github) == 1
    error_message = "An existing account-wide OIDC provider must be reused by default."
  }
  assert {
    condition = jsondecode(aws_iam_role.runtime.assume_role_policy).Statement[0].Condition.StringEquals == {
      "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
      "token.actions.githubusercontent.com:sub" = ["repo:kzk-maeda/itoma:ref:refs/heads/main"]
    }
    error_message = "Trust must require the exact repository/branch and STS audience."
  }
}

run "runtime_cannot_administer_infrastructure_or_other_projects" {
  command = plan
  assert {
    condition = toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[0].Action) == toset([
      "devicefarm:CreateUpload", "devicefarm:GetUpload", "devicefarm:DeleteUpload",
      "devicefarm:GetDevicePool", "devicefarm:GetDevicePoolCompatibility", "devicefarm:ScheduleRun",
      "devicefarm:ListRuns", "devicefarm:GetRun", "devicefarm:StopRun", "devicefarm:ListJobs",
      "devicefarm:ListSuites", "devicefarm:ListTests", "devicefarm:ListArtifacts",
    ])
    error_message = "Runtime permissions must exclude resource administration, IAM and state access."
  }
  assert {
    condition = toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[0].Resource) == toset([
      "arn:aws:devicefarm:us-west-2:123456789012:project:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "arn:aws:devicefarm:us-west-2:123456789012:devicepool:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "arn:aws:devicefarm:us-west-2:123456789012:upload:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/*",
      "arn:aws:devicefarm:us-west-2:123456789012:run:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/*",
      "arn:aws:devicefarm:us-west-2:123456789012:job:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/*",
      "arn:aws:devicefarm:us-west-2:123456789012:suite:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/*",
      "arn:aws:devicefarm:us-west-2:123456789012:test:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/*",
    ])
    error_message = "Runtime access must stay within one project and its owned pool."
  }
}

run "three_explicit_devices_and_branch_allowlist" {
  command = plan
  variables {
    device_arns = [
      "arn:aws:devicefarm:us-west-2::device:EXAMPLE3",
      "arn:aws:devicefarm:us-west-2::device:EXAMPLE1",
      "arn:aws:devicefarm:us-west-2::device:EXAMPLE2",
    ]
    github_branches = ["main", "feat/device-farm-e2e"]
  }
  assert {
    condition = aws_devicefarm_device_pool.ios.max_devices == 3 && (
      toset(jsondecode(one([for rule in aws_devicefarm_device_pool.ios.rule : rule if rule.attribute == "ARN"]).value)) == var.device_arns
    )
    error_message = "The pool must contain exactly the three selected catalogue identities."
  }
  assert {
    condition = toset(jsondecode(aws_iam_role.runtime.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]) == toset([
      "repo:kzk-maeda/itoma:ref:refs/heads/main", "repo:kzk-maeda/itoma:ref:refs/heads/feat/device-farm-e2e",
    ])
    error_message = "An additional branch must remain an exact subject, not a wildcard."
  }
}

run "create_oidc_only_when_explicitly_selected" {
  command = plan
  variables {
    create_github_oidc_provider = true
  }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 1 && length(data.aws_iam_openid_connect_provider.github) == 0
    error_message = "OIDC creation must be explicit and must not also look up an existing provider."
  }
}

run "reject_more_than_three_devices" {
  command = plan
  variables {
    device_arns = [for n in range(4) : "arn:aws:devicefarm:us-west-2::device:EXAMPLE${n}"]
  }
  expect_failures = [var.device_arns]
}

run "reject_empty_pool" {
  command = plan
  variables {
    device_arns = []
  }
  expect_failures = [var.device_arns]
}

run "reject_other_region" {
  command = plan
  variables {
    device_arns = ["arn:aws:devicefarm:ap-northeast-1::device:EXAMPLE1"]
  }
  expect_failures = [var.device_arns]
}

run "reject_wildcard_repository" {
  command = plan
  variables {
    github_repository = "kzk-maeda/*"
  }
  expect_failures = [var.github_repository]
}

run "reject_wildcard_branch" {
  command = plan
  variables {
    github_branches = ["*"]
  }
  expect_failures = [var.github_branches]
}

run "reject_existing_provider_without_sts_audience" {
  command = plan
  override_data {
    target = data.aws_iam_openid_connect_provider.github[0]
    values = {
      arn            = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      url            = "token.actions.githubusercontent.com"
      client_id_list = ["other-audience"]
    }
  }
  expect_failures = [data.aws_iam_openid_connect_provider.github]
}
