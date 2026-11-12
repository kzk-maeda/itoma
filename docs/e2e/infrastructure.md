# TerraformによるE2E基盤の管理

[E2Eの入口](README.md) / [テスト実行手順](runbook.md) / [構成](architecture.md)

## 管理はどのタイミングで必要か

常設リソースは初回構築後も、端末/OSの追加・廃止、GitHub repo/許可branchの変更、権限やproviderの更新時に変更する。毎回コンソールでProjectやPoolを作り直す運用にはしない。

| 対象 | 管理するコード | 変更・後処理のタイミング |
| --- | --- | --- |
| Project / Device Pool | [infra/device-farm](../../infra/device-farm) | 初回、選定端末の入替え、名前/タグ/実行上限の見直し |
| GitHub OIDC / runtime IAM role/policy | 同上 | 初回、許可repo/branch・使用APIの変更。共有OIDCは既存の管理元を尊重 |
| Terraform state用S3 | [infra/state-bootstrap](../../infra/state-bootstrap) | state基盤がない場合の初回構築。versioning/暗号化/非公開/TLS必須を維持 |
| IPA / テスト / spec upload | [run.py](../../scripts/device_farm/run.py) | 各実行で作成し、終了/失敗時に今回のuploadを削除 |
| runと結果の記録 | 同上、Actions artifact | 各実行でAPI管理。runの記録は残し、Terraform stateへ取り込まない |
| GitHub Variables/Secrets | Terraform出力を[実行手順](runbook.md)どおり登録 | 初回、ARN/roleが変わった場合。アクセスキーはTerraformで生成しない |

AWSに常設するのはProject、Pool、OIDC/IAMとstate用S3。専用端末、スロット契約、アプリ用バックエンド、IPAビルド/署名基盤は作成しない。テストのActions artifact保持は7日。Device Farm側の結果記録は別管理で、Terraformのapplyを毎回の実行/履歴削除に使わない。

## 前提

- Terraform 1.17.2以上、AWS CLI、GitHub CLI。AWS providerの実版は各rootのlockfileに固定する。
- 構築担当はAWS SSO等で認証し、対象accountを確認する。AWSの認証情報は環境変数/プロファイルで渡し、tfvars/backend設定へ埋め込まない。
- `aws_account_id`は両rootで必須。providerは違うaccountでの操作を拒否し、リージョンは既存runnerと同じ`us-west-2`に固定する。backend設定の`allowed_account_ids`も実際のaccountへ置き換え、state接続先の取り違えを防ぐ。
- Terraform構築担当のIAM/S3管理権限と、E2E runtime roleを分ける。runtime roleはDevice Farmの対象Project内での実行/回収に限定し、Project/Pool作成・IAM・state読取は許可しない。

以下はrepo rootからの操作。例のaccount/bucket/device値を実際の値へ置き換える。planとstateは認証情報を含み得るため、repoやActions artifactへ保存しない。

## 1. state保管先を用意する

既存のTerraform state用S3がある場合は、このbootstrapを実行せず、bucketの管理元とkey/権限を確認して次の節へ進む。既存bucketを別stateへ二重登録しない。

新規の場合はまずlocal stateでbucketを作る。

```sh
cp infra/state-bootstrap/terraform.tfvars.example infra/state-bootstrap/terraform.tfvars
# account IDと、一意なbucket_nameを編集する。
terraform -chdir=infra/state-bootstrap init -input=false
terraform -chdir=infra/state-bootstrap plan -out=bootstrap.tfplan
# planを確認してから適用する。
terraform -chdir=infra/state-bootstrap apply bootstrap.tfplan
terraform -chdir=infra/state-bootstrap output -raw bucket_name
```

bucketは非公開、SSE AES256、versioning、TLS必須、`force_destroy=false`で構築する。S3とDevice Farm Project、作成したOIDC providerは`prevent_destroy`を持つ。通常の変更に削除/置換が含まれたら、既存結果や共有利用への影響を先に確認する。

作成後、bootstrap自身のstateも同じbucketの別keyへ移す。

```sh
cp infra/state-bootstrap/backend.hcl.example infra/state-bootstrap/backend.hcl
# bucketとallowed_account_idsを実際の値へ編集する。keyはdevice-farm用と分ける。
cp infra/state-bootstrap/backend_override.tf.example infra/state-bootstrap/backend_override.tf
terraform -chdir=infra/state-bootstrap init -migrate-state -backend-config=backend.hcl
terraform -chdir=infra/state-bootstrap state list
```

移行前のlocal state/backupは移行完了まで安全に保持する。移行後はbackend設定とAWS権限を使って共有stateへ接続する。stateの復旧にはS3 versioningとlockを使い、古いlocal stateを正本へ戻さない。

S3 backendの実行者には、bucketの`ListBucket`、対象state keyの`GetObject/PutObject`、対象`.tflock`の`GetObject/PutObject/DeleteObject`が必要。`use_lockfile=true`によるS3 lockを使い、DynamoDB tableは追加しない。担当の既存SSO role等で権限を付け、E2E runtime roleへstateアクセスを追加しない。

## 2. Device Farm・OIDC・IAMを構築する

```sh
cp infra/device-farm/terraform.tfvars.example infra/device-farm/terraform.tfvars
cp infra/device-farm/backend.hcl.example infra/device-farm/backend.hcl
# account、実在する公開iOS18+端末のARN、許可branch、state bucketを編集する。
terraform -chdir=infra/device-farm init -backend-config=backend.hcl -input=false
terraform -chdir=infra/device-farm plan -out=device-farm.tfplan
# planの対象account、選定端末、OIDCの再利用/作成、IAMの範囲を確認する。
terraform -chdir=infra/device-farm apply device-farm.tfplan
```

端末の候補はAWSコンソールかCLIで調べる。最初は公開iPhone1台、OS18以上を選ぶ。

```sh
aws devicefarm list-devices --region us-west-2 \
  --query "devices[?platform=='IOS' && fleetType=='PUBLIC'].[name,os,arn]" --output table
```

`device_arns`は1〜3件の明示指定。Poolの上限はその件数と一致させ、PoolにもPUBLIC/IOS/OS18以上のruleを付ける。Terraformはcatalogueから任意の端末を自動選択しない。fleet/OS/IPA互換性は実行時にもrunnerが検査する。端末が廃止された場合は新しいARNを選び、tfvars変更→plan→applyする。

### 共有OIDCを二重管理しない

既定の`create_github_oidc_provider=false`は、同accountの`token.actions.githubusercontent.com`をdata sourceで参照する。既存providerのURLとSTS audienceを検査する。

```sh
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
```

providerがない場合だけ`create_github_oidc_provider=true`にする。既存のproviderを別のTerraform/CloudFormation等が管理している場合は再利用し、このstateへimportしない。自分が作成済みのproviderを再利用へ切り替える場合も、先にstateの所有関係を移行する。単なるflag変更で共有providerを削除しない。

roleのtrustはrepoとbranchの完全一致、およびaudience `sts.amazonaws.com`に限定する。通常は`github_branches=["main"]`。PR前に手動実行を許可するときだけ具体的な作業branchを追加し、終了後に戻す。現在のworkflowはGitHub Environmentを指定しないため、environment形式のOIDC subjectには対応させていない。

## 3. Terraform出力を既存Actionsへ接続する

```sh
gh variable set DEVICE_FARM_PROJECT_ARN --repo kzk-maeda/itoma \
  --body "$(terraform -chdir=infra/device-farm output -raw project_arn)"
gh variable set DEVICE_FARM_DEVICE_POOL_ARN --repo kzk-maeda/itoma \
  --body "$(terraform -chdir=infra/device-farm output -raw device_pool_arn)"
gh secret set AWS_ROLE_ARN --repo kzk-maeda/itoma \
  --body "$(terraform -chdir=infra/device-farm output -raw runtime_role_arn)"
```

role ARNは認証秘密ではないが、既存workflowの入力に合わせSecretへ登録する。GitHubの設定はこのTerraformのstateには含めない。`ITOMA_IOS_BUNDLE_ID`と対応IPAも[テスト実行手順](runbook.md)に従って準備する。TerraformのapplyでテストrunやIPAビルドが起動することはない。

## 4. 既存リソースを引き継ぐ場合

未管理のProject/Poolがすでにある場合は、同名の新規作成より先にimportする。tfvarsを既存の名前/端末設定に合わせ、bootstrap/backendを初期化したうえで実行する。

```sh
terraform -chdir=infra/device-farm import aws_devicefarm_project.e2e PROJECT_ARN
terraform -chdir=infra/device-farm import aws_devicefarm_device_pool.ios DEVICE_POOL_ARN
terraform -chdir=infra/device-farm plan
```

既存roleをこのstateへ引き継ぐ場合、設定したprefixから生成される名前と一致するものだけを対象にする。

```sh
terraform -chdir=infra/device-farm import aws_iam_role.runtime ROLE_NAME
terraform -chdir=infra/device-farm import aws_iam_role_policy.runtime ROLE_NAME:device-farm-runtime
```

別stateの所有リソースは勝手にimportしない。SSO/共有IAM roleをE2E専用roleへ置き換えない。新しい専用roleを作成して`AWS_ROLE_ARN`を切り替える構成も使える。import直後は差分を確認し、意図しない削除/置換や既存権限の喪失がないことを確認する。

## 5. 日常の変更と検証

端末や許可branchの変更はtfvars、リソース構成やIAM使用APIの変更は`.tf`へ反映する。PRレビュー→実環境planの確認→apply→変更されたARNのGitHub登録→手動E2Eの順に行う。実行ごとのupload/runをTerraformへ追加しない。通常のapplyでProjectやstateを削除せず、廃止は保存結果・共有OIDC・stateの扱いを決めた別の変更として扱う。

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/device-farm init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/device-farm validate
terraform -chdir=infra/device-farm test
terraform -chdir=infra/state-bootstrap init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/state-bootstrap validate
terraform -chdir=infra/state-bootstrap test
```

[Terraform checks workflow](../../.github/workflows/terraform.yml)はAWS認証なしでbackend接続を無効にし、mock providerのplanテストを実行する。これは実AWSのplan/applyや権限成立の検証ではない。普段backendを設定している作業copyではなく、検証用の新しいcheckoutで実行するとbackend再設定を避けられる。変更時は既存[E2E保守ルール](scenarios.md)も確認し、インフラ検証・シナリオの実機実行・未実施を分けてPRへ記録する。

CLI/providerを更新する場合はversion制約・`infra/.terraform-version`・CIのCLI版・両rootのlockfileを揃える。lockfileはコミットし、`.terraform/`・実環境tfvars・backend設定・state/backup・保存したplanはコミットしない。

## 参照仕様

[Project](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/devicefarm_project)、[Device Pool](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/devicefarm_device_pool)、[GitHub OIDC provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_openid_connect_provider)、[S3 backendとlock](https://developer.hashicorp.com/terraform/language/backend/s3)、[認証なしのprovider mock](https://developer.hashicorp.com/terraform/language/tests/mocking)。コードはAWS provider 6.73.0、Terraform 1.17.2で検証する。
