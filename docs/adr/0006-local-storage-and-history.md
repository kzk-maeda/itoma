# 0006: controlと理由・履歴を分けたネイティブSQLite保存を使う

- 状態: **Accepted**（PR #36の人間によるmainマージで採用）
- 検討Issue: https://github.com/kzk-maeda/itoma/issues/25
- 決定PR: https://github.com/kzk-maeda/itoma/pull/36 （2026-11-06 JST、人間がmainへマージ）
- 方針了承: 2026-11-06 JST、[利用者判断](https://github.com/kzk-maeda/itoma/pull/36#issuecomment-6685704584)
- 採用日: 2026-11-06 JST
- 採用版: `6c17ac9a334a020a6833268a2f1a5762dc9aabc6`（PR #36のmerge commit）
- 検証状況: 設計上の検討のみ。純粋ロジックのテスト仕様を作成、実装・実機は未検証
- 関連ADR: [0002 MVP](0002-mvp-scheduled-restrictions.md)。0003〜0006は同じ設計PRの相互依存する提案

## 背景

確定設定と解除期限は本体停止後も必要。利用者は将来の履歴表示のため、理由本文と操作記録も保存したい。一方、Extensionの制限評価に理由本文は不要。保存不良で黙って全初期化しないことも求められている。

## 選択肢と比較

| 案 | 評価 |
| --- | --- |
| UserDefaults | 単純だがcommand/履歴/複数値のatomicityと移行を別実装 |
| JSON＋原子的置換 | 小さいsnapshotに良いが競合/追記/検索を自作 |
| 単一共有SQLiteに理由も保存 | transactionが単純になるが機微な本文をExtensionと同じ共有領域へ置く |
| **共有control SQLite＋本体private履歴SQLite** | 必要最小の共有と本文保護が明確。2DB間の受渡し・復旧が必要 |
| SwiftData/Core Data | オブジェクト支援はあるが共有・移行・学習範囲が増える |

## 決定

iOS標準SQLiteを薄いSwift Repositoryで扱い、shared controlを状態の正本、private DBを理由/履歴の正本とする。controlには有効policyとPending候補、grantの初期/実効期限、予定receipt/世代を別々に保持する。shared outboxをeventIDで冪等取込。本体はprivateとsharedのwrite lockを同時保持しない。理由本文は本人の反映後のみ保存し、入力途中の取消は本文を保存しない案。

詳細仕様の正本は [data.md](../system/data.md)。採用した設計仕様であり、実装・OS動作の検証済み宣言ではない。

## 影響・限界

方式は変更可能だが配布後の移行が必要。共有group ID、schema、付随ファイル、ロックとFile Protection/バックアップ属性は実機確認必須。保持は自動期間削除なし、容量警告/停止と本人削除の方針が了承済み。閾値80/100MiBは実測後に確定する暫定値、outbox上限1万件も実測前の暫定候補で、測定済みの最適値ではない。履歴欠損は明示し、履歴障害だけで再制限・本人の停止を妨げない。

## 証拠と採用条件

Issueの利用者回答とPR上の7項目の了承を根拠とする。P1/P2を含む修正版はPR #36のmainマージで設計として採用された。登録APIの制約・配信・再制限の実機検証は未実施。OS APIの現行仕様と端末条件は [PoC計画](../system/poc-plan.md) で確認する。提案の採用と実機での成立を分け、失敗したら範囲/方式を見直す。比較対象のAPIを実装済み・動作済みと記載しない。

## 再検討条件

Extensionの保護/lock制約に合わない、private/shared受渡しが過剰、理由本文の保持要望が変わる、容量/移行/復旧コストが許容できない場合。
