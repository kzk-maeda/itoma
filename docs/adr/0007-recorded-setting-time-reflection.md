# 0007: 記録した有効設定の経過区間から振り返りを計算する案

- 状態: **Proposed**。人間による採用レビュー待ち
- 検討Issue: https://github.com/kzk-maeda/itoma/issues/96
- 後続: #97 / #98 / #99 / #100。操作履歴は #57 / #132
- 根拠: 本人了承の固定累計＋週次/月次UI。未採用の記録/集計/削除の方式を、UI了承から自動採用しない

## 提案

過去の有効設定区間を、記録したpolicy/Activation/contextからnativeでunionする。重複時間は1度、未来を除き、一時解除を差し引かない。実OS遮断/集中時間とは呼ばない。記録開始前/欠損/削除と既知0を区別し、現在の設定から未記録の過去を埋めない。

private ledger/read revisionと固定as-ofから、上部の全記録累計と選択週/月の有界DTOを同じtokenで返す。理由・操作履歴の既存削除は累計を消す意味へ変えず、累計も消す新しい明示操作を分ける。

詳細・代替案・例・timezone/時計変更の限界・migration/coverage/cutoffの採用条件は [契約案](../system/time-reflection-contract.md)。

## 採否と検証

このADRをAcceptedへ変更するには、人間による内容レビューと決定PRのmain反映が必要。独立agent reviewや文書CIだけでは採用済みにしない。採用後に後続実装をReadyへ進める。新しい記録のiOS実機成立、App Groups/File Protection、実プロセス停止/再起動は別に検証する。
