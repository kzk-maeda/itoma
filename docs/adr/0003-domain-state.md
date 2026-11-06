# 0003: 設定・認可・一時解除・OS観測を独立した状態として扱う

- 状態: **Accepted**（PR #36の人間によるmainマージで採用）
- 検討Issue: https://github.com/kzk-maeda/itoma/issues/22
- 決定PR: https://github.com/kzk-maeda/itoma/pull/36 （2026-11-06 JST、人間がmainへマージ）
- 方針了承: 2026-11-06 JST、[利用者判断](https://github.com/kzk-maeda/itoma/pull/36#issuecomment-6685704584)
- 採用日: 2026-11-06 JST
- 採用版: `6c17ac9a334a020a6833268a2f1a5762dc9aabc6`（PR #36のmerge commit）
- 検証状況: 設計上の検討のみ。純粋ロジックのテスト仕様を作成、実装・実機は未検証
- 関連ADR: [0002 MVP](0002-mvp-scheduled-restrictions.md)。0003〜0006は同じ設計PRで採用した相互依存する判断

## 背景

単一フラグなら画面は簡単だが、設定保存成功とOS反映失敗、期限切れと再制限失敗、認可喪失を区別できない。利用者は設定保持・明示的な再試行・絶対期限・再認可後の確認を求めている。

## 選択肢と比較

| 案 | 評価 |
| --- | --- |
| 単一isBlocked | 状態矛盾を隠し、失敗復旧や本人の意図を表せない |
| 全イベントから再構築するevent sourcing | 追跡性は高いがsnapshot/移行/再生のコスト増 |
| **版付きsnapshot＋command/grant＋独立したOS観測** | 必要な状態・履歴を明示し、実機観測の限界も表現できるため推奨 |

## 決定

有効policy、永続化したPending候補、画面draftを分離し、最終有効化時にglobal revisionで更新競合を拒否する。grantは対象・ruleVersion・occurrenceと、受理時のinitialExpiresAt/単調に短縮するeffectiveExpiresAtを持ち、再試行で延長しない。command受理/結果、観測の鮮度・証拠を分ける。履歴は監査用で、ドメイン状態の再構築の唯一の正本にはしない。

詳細仕様の正本は [domain-model.md](../system/domain-model.md)。採用した設計仕様であり、実装・OS動作の検証済み宣言ではない。

## 影響・限界

DTOと状態数は増えるが、未適用を成功表示する誤りを避ける。次境界を過ぎた観測を古いものと扱う。解除前に実効期限のOS予定登録とreceipt保存を必須とし、登録失敗なら解除しない。登録受理と配信保証は別で、本体終了時のOS再制限は別PoC。状態モデル/遷移表のD01〜D14を実装テストへ渡す。

## 証拠と採用条件

Issueの利用者回答とPR上の7項目の了承を根拠とする。P1/P2を含む修正版はPR #36のmainマージで設計として採用された。登録APIの制約・配信・再制限の実機検証は未実施。OS APIの現行仕様と端末条件は [PoC計画](../system/poc-plan.md) で確認する。提案の採用と実機での成立を分け、失敗したら範囲/方式を見直す。比較対象のAPIを実装済み・動作済みと記載しない。

## 再検討条件

OS側で観測可能な情報が想定より少ない、grantの束縛が利用者体験と合わない、イベント保存が状態の正本より複雑になる場合。
