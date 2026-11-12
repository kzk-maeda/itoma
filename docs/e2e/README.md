# E2Eテスト

E2Eの設計・実行・保守の入口。関連Issueは[#156](https://github.com/kzk-maeda/itoma/issues/156)。初期範囲はAWS Device Farm公開実機上のUIスモークで、コード実装と実機合格は別に扱う。

| 目的 | 読む資料 |
| --- | --- |
| AWS/Secrets/IPAを準備し、手動実行して結果を読む | [実行手順](runbook.md) |
| 機能・画面変更に合わせてシナリオを追加・更新する | [シナリオの保守手順](scenarios.md) |
| 全体構成、Pythonの役割、合否判定と検証範囲を理解する | [構成と判断理由](architecture.md) |
| 実行roleのIAM権限を設定する | [IAM policy例](device-farm-iam-policy.json) |

## コードの場所

| ファイル | 責務 |
| --- | --- |
| [e2e/scenarios.json](../../e2e/scenarios.json) | 実行対象のシナリオID・名前の一覧。Node/Pythonの合否判定が共通で参照する |
| [e2e/tests/smoke.test.mjs](../../e2e/tests/smoke.test.mjs) | Appiumによる操作・待機・期待結果。実行可能なシナリオの正本 |
| [e2e/run.mjs](../../e2e/run.mjs) | Nodeテスト起動、JUnit出力、登録シナリオの欠落/skipを拒否 |
| [e2e/device-farm.yml](../../e2e/device-farm.yml) | AWS test host上のNode/Appium/WDA起動とテスト実行 |
| [.github/workflows/device-farm-e2e.yml](../../.github/workflows/device-farm-e2e.yml) | GitHub Actionsの手動トリガー、入力/出所の検査、認証、実行、artifact保存 |
| [scripts/device_farm/prepare.py](../../scripts/device_farm/prepare.py) | IPA検査・テストパッケージ作成。AWSアクセスなし |
| [scripts/device_farm/run.py](../../scripts/device_farm/run.py) | AWS upload/実行監視/停止/証跡回収/合否判定/cleanup |
| [tests/device_farm/test_device_farm.py](../../tests/device_farm/test_device_farm.py) | AWSアクセスなしの基盤回帰。実機E2Eの代用ではない |

シナリオはこのrepoで保守する。AWSコンソール側で別のテストコードを編集する運用にはしない。画面・機能を変えるagentへの必須指示はルートの[AGENTS.md](../../AGENTS.md#e2e-maintenance)、作業手順は[開発フロー](../development-workflow.md)、レビュー時の記録欄は[PRテンプレート](../../.github/pull_request_template.md)にある。

## 他のQAとの使い分け

- [署名不要Simulator QA](../ios-qa.md): iOS build/install/launch、JS→Swiftの接続と画像を確認する。
- [Screen Time実機PoC](../ios-device-poc.md): 署名済み端末で認可・Picker・実制限などを確認する。
- [通常画面のQA記録](../qa/main-application-flow.md): 既存の合成Web画面と検証範囲を参照する。

これらの既存手順・過去の証跡は元の場所に保持する。公開実機UIスモーク、Simulator、署名済みScreen Time実機QAの結果を混ぜない。
