# E2E infrastructure

常設のAWSリソースをTerraformで管理する。[構築・変更・import・state移行の手順](../docs/e2e/infrastructure.md)を正本とする。

| Root module | 管理するリソース |
| --- | --- |
| [state-bootstrap](state-bootstrap) | Terraform state用S3、versioning、暗号化、public access block、TLS policy。既存state基盤があれば省略可能 |
| [device-farm](device-farm) | Device Farm Project、端末ARNを固定したPool、GitHub OIDC、E2E実行用IAM role/policy |

Terraform 1.17.2、AWS provider 6.73.xを使用し、各rootの`.terraform.lock.hcl`をコミットする。認証情報・state・plan・実環境tfvarsはコミットしない。

CIはbackend接続を無効にし、mock providerのplanテストを実行する。AWSリソースの作成/変更や有料のDevice Farm runは起動しない。実行ごとのupload/runは[既存runner](../scripts/device_farm/run.py)が管理する。
