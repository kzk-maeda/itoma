# Architecture Decision Records

重要な選択の理由・代替案・結果を、[設計Issue](../system/README.md) とPRに結び付けて残します。

1. `0001-topic.md` のようにmainの最新連番を確認し、[テンプレート](template.md)をコピーする。並行PRで番号が衝突したらマージ前に調整する。
2. 状態は Proposed から開始。Issueに比較案と証拠を集める。
3. 人間のレビューを経て、採用するPRで Accepted と採用日を記載する。mainへのマージ前は確定と扱わない。
4. 不採用は Rejected、置換されたものは Superseded とする。採用後の判断理由を消さず、新ADRから前のADRへリンクする。
5. Acceptedは設計判断の採用であり、実機検証合格ではない。検証状況と残るリスクを別欄に持つ。

ADR 0002はPR #31のmainマージ（2026-11-04 JST）、0003〜0006はPR #36のmainマージ（2026-11-06 JST）で採用済みです。既に確定したiOS/React Native/Swift/Local-firstの方針はhandoverを参照し、再選定しません。

## ADR一覧

| ADR | 状態 | 検討Issue |
| --- | --- | --- |
| [0001: 仮説検証用WebデモをCloudflareで段階導入する](0001-cloudflare-web-demo.md) | Proposed | [#28](https://github.com/kzk-maeda/itoma/issues/28) |
| [0002: 編集可能な時間帯ルールとルール別の解除条件をMVPとする](0002-mvp-scheduled-restrictions.md) | Accepted（2026-11-04 JST、#31） | [#21](https://github.com/kzk-maeda/itoma/issues/21) |
| [0003: 設定・認可・一時解除・OS観測の状態](0003-domain-state.md) | Accepted（2026-11-06 JST、#36） | [#22](https://github.com/kzk-maeda/itoma/issues/22) |
| [0004: 日跨ぎと本人が選ぶ優先順](0004-rule-precedence.md) | Accepted（2026-11-06 JST、#36） | [#23](https://github.com/kzk-maeda/itoma/issues/23) |
| [0005: 小さいMVVMと共通Swift Domain](0005-native-domain-and-mvvm.md) | Accepted（2026-11-06 JST、#36） | [#24](https://github.com/kzk-maeda/itoma/issues/24) |
| [0006: controlと本文・履歴のSQLite分離](0006-local-storage-and-history.md) | Accepted（2026-11-06 JST、#36） | [#25](https://github.com/kzk-maeda/itoma/issues/25) |
| [0007: 一時解除を除いた制限時間を振り返る](0007-recorded-setting-time-reflection.md) | Accepted（本人がPR134を採用・マージ、実機未検証） | [#96](https://github.com/kzk-maeda/itoma/issues/96) |
| [0008: E2Eの常設リソースをTerraformで管理する](0008-device-farm-terraform.md) | Proposed（Terraformは本人指定、具体構成レビュー・AWS apply未実施） | [#156](https://github.com/kzk-maeda/itoma/issues/156) |
