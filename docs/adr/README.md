# Architecture Decision Records

重要な選択の理由・代替案・結果を、[設計Issue](../system/README.md) とPRに結び付けて残します。

1. `0001-topic.md` のようにmainの最新連番を確認し、[テンプレート](template.md)をコピーする。並行PRで番号が衝突したらマージ前に調整する。
2. 状態は Proposed から開始。Issueに比較案と証拠を集める。
3. 人間のレビューを経て、採用するPRで Accepted と採用日を記載する。mainへのマージ前は確定と扱わない。
4. 不採用は Rejected、置換されたものは Superseded とする。採用後の判断理由を消さず、新ADRから前のADRへリンクする。
5. Acceptedは設計判断の採用であり、実機検証合格ではない。検証状況と残るリスクを別欄に持つ。

現時点で採用済みの新規ADRはありません。既に確定したiOS/React Native/Swift/Local-firstの方針はhandoverを参照し、再選定しません。

## 検討中のADR

| ADR | 状態 | 検討Issue |
| --- | --- | --- |
| [0001: 仮説検証用WebデモをCloudflareで段階導入する](0001-cloudflare-web-demo.md) | Proposed | [#28](https://github.com/kzk-maeda/itoma/issues/28) |
| [0002: 編集可能な時間帯ルールとルール別の解除条件をMVPとする](0002-mvp-scheduled-restrictions.md) | Proposed（利用者合意を反映、マージ待ち） | [#21](https://github.com/kzk-maeda/itoma/issues/21) |
