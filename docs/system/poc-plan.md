# 実機PoCの検証計画

状態: **提案・未確定**。検討Issue: https://github.com/kzk-maeda/itoma/issues/26。この文書は実装・OS動作の保証ではありません。


## 実行前の条件

[#8](https://github.com/kzk-maeda/itoma/issues/8) でMac/Xcode・検証用iPhone・開発署名・Family Controls entitlement・本体/Extension構成を確認します。接続済みCodexやSimulatorだけで利用可能と扱いません。秘密情報は安全な設定に置き、署名変更・申請・費用・配布は必要な承認を別途得ます。

## 仮説と採否基準の初期案

| 検証 | 環境 | 観測する結果 | 判断 |
| --- | --- | --- | --- |
| Swiftブリッジ・起動 | Simulator/実機 | 対象ビルドのネイティブ応答 | 不成立なら基盤を修正 |
| 認可・対象選択・取消 | iPhone実機 | 許可/拒否/取消後の状態と対象保持 | 取得範囲に合わせてUIを修正 |
| 手動Shield適用/解除 | iPhone実機 | 選択対象のみの制限と解除 | 成功前に時間帯実装へ依存させない |
| Shieldから本体への導線 | iPhone実機 | 公式APIで可能な操作と制約 | 不成立なら解除導線を変更 |
| 期限後の再制限 | iPhone実機 | JS停止中のOSイベントと実際の適用時刻 | 保証範囲を定義。不成立なら仕様変更/保留 |
| 競合・復旧 | iPhone実機 | kill/再起動/時計変更/通信断/権限取消 | 復帰時の再評価と誤表示を確認 |
| VoiceOver等 | Simulator/実機を区別 | 結果通知、フォーカス、文字拡大、Reduce Motion | 見た目だけで完了としない |

期限精度の許容値、対象OS範囲、実施回数は仕様決定Issueで事前に定めます。結果を見て都合よく合格条件を変えず、変更理由をADRへ残します。

## 1試験の記録テンプレート

- 検証ID / 関連Issue / 検証した仮説:
- 期待結果・採用/変更/保留の判定基準:
- 本体・Extensionのcommit SHA / JSバンドル / ビルドID / 構成一致:
- 端末またはSimulator / iOS / Xcode / 実施日時・タイムゾーン:
- 事前状態（権限・policy revision・対象・期限）:
- 操作と再現手順:
- 観測結果・イベント時刻・適用時刻・画像/ログへのリンク:
- PASS / FAIL / BLOCKED / NOT RUN と理由:
- 残る不確実性 / ADR / 次のIssue:

計画追加時点では全試験が**未実施**です。古いビルドは `stale native build` とし、この設計の動作証明には使いません。証跡には個人のトークンや理由入力を含めません。


## 本設計PRから追加する検証ゲート（未実施）

- 状態D01〜D12、ルールR01〜R10、保存S01〜S08は各設計文書のテスト仕様。単体/プロセス競合/実機で適切に分けて実行する。
- writer lock保持中のkill/OS操作/Extension時間予算を確認。短い同期Adapterで成立しなければADR 0005/0006を再検討する。
- private理由保存とshared intent/履歴outboxの間で中断し、重複・成功誤認・本文漏えいがないことを確認。
- 第三者の制限と自分のstoreを区別し、own-store readbackでOS全体の制限成功と誤表示しない。
- 再認可後の本人承認、期限精度、DST/時計変更、OS再起動後の最初のアンロック前を検証条件に含める。
- 容量80/100MiB・outbox1万件は設計提案値。実ファイル/WAL増加・処理時間・復旧を測定し、しきい値をレビューする。
- 画面往復100回でstack/購読/timerが増え続けないか測定する。

必要な公式資料の確認先: [SQLite transactions](https://www.sqlite.org/lang_transaction.html)、[SQLite WAL](https://www.sqlite.org/wal.html)、[App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups)、[File Protection](https://developer.apple.com/documentation/foundation/fileprotectiontype)、[FamilyControls](https://developer.apple.com/documentation/familycontrols)、[ManagedSettings](https://developer.apple.com/documentation/managedsettings)、[DeviceActivity](https://developer.apple.com/documentation/deviceactivity)。本環境ではSQLite/Apple公式ページの取得がプロキシ403だったため、現行API仕様・制約は実装前に到達可能な環境で確認する。
