# 0008: E2Eの常設リソースをTerraformで管理する

状態: **Proposed**。利用者がTerraformでのIaC管理を指定。以下の具体的な構成は[#156](https://github.com/kzk-maeda/itoma/issues/156) / [PR #157](https://github.com/kzk-maeda/itoma/pull/157)でレビューし、AWSへのapply・実機合格とは区別する。

## 背景

Device Farmは毎回Project/Poolを作り直す必要はないが、端末やOSの入替え、実行権限、GitHubの許可branchの変更を継続して管理する。コンソールでの設定だけでは差分と再構築手順を追いにくい。

## 構成

- `infra/device-farm`でProject、1〜3台を明示指定するPool、GitHub OIDC、対象Projectに限定したruntime role/policyを管理する。
- `infra/state-bootstrap`で必要な場合だけstate用S3を作る。暗号化・非公開・versioning・TLSとS3 lockを使い、bootstrap自身のstateも別keyへ移行する。
- 既存の共有OIDCやstate基盤は既定で再利用し、他のstateへ二重登録しない。
- 各テストのupload/runはAPI runnerが所有し、Terraformへ取り込まない。今回作成したuploadをcleanupし、runの結果記録は残す。
- 構築担当とruntime roleを分離する。runtimeにIAM変更・Project/Pool作成・stateアクセスを与えない。repo/branchは完全一致でtrustへ記載する。
- GitHub workflowはGitで管理し、Variablesとrole ARNはTerraform出力を登録する。GitHubの設定や認証キー自体はこのstateへ含めない。
- CIはbackend無効・mock providerのplan検証に限定する。実AWSのplan/applyとDevice Farm実行は別に記録する。

## 比較と結果

常設資源の手動管理だけを続ける案は差分/再構築が追いにくい。全テストのrun/uploadまでTerraformに入れる案は、実行履歴がstateへ蓄積しcleanupの所有者も重複するため採らない。Terraformという選択は利用者指定を前提とし、別のIaC製品へ再選定しない。

state保管先とprovider/CLI更新の管理が加わる。既存資源のimport、共有OIDCの所有、初回のstate移行を明示的に扱う必要がある。Project/S3/作成したOIDCは`prevent_destroy`を持つ。詳細と変更手順は[E2Eインフラ管理](../e2e/infrastructure.md)へ集約する。

## 検証

Terraform fmt/validateと、AWS認証なしのmock planテストで構成・権限の範囲・入力制約を確認する。実AWSのresource作成、OIDCでのassume、stateのS3実アクセス、Device Farm実機実行は未実施。人間のレビュー/マージを設計採用とし、mockの成功をAWS成立の証明にしない。
