output "project_arn" {
  description = "GitHub Actions variable DEVICE_FARM_PROJECT_ARN."
  value       = aws_devicefarm_project.e2e.arn
}

output "device_pool_arn" {
  description = "GitHub Actions variable DEVICE_FARM_DEVICE_POOL_ARN."
  value       = aws_devicefarm_device_pool.ios.arn
}

output "runtime_role_arn" {
  description = "GitHub Actions secret AWS_ROLE_ARN; this ARN is not a credential."
  value       = aws_iam_role.runtime.arn
}
