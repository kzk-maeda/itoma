# 実機PoCの検証計画

状態: **提案・未確定**。検討Issue: https://github.com/kzk-maeda/itoma/issues/26。この文書は実装・OS動作の保証ではありません。

認可・Picker・opaque選択保存・専用storeの限定PoCと現行公式資料の確認は[実機PoC手順](../ios-device-poc.md)へ分離する。#105のコード/Simulator成功は親#8/#12/#13の実機ゲートや本計画の採用ではない。Developer未登録/端末未確認の外部条件と、独立に実装・コンパイルできる範囲を区別する。


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

- 状態D01〜D14、ルールR01〜R14、保存S01〜S12は各設計文書のテスト仕様。単体/プロセス競合/実機で適切に分けて実行する。
- 期限予定の登録/更新/取消API、最小間隔・精度・上限・Extension時間予算を現行公式資料と実機で確認する。登録受理は将来の配信保証と区別する。実効期限を表現できなければ解除を許さず、JS timerで代替しない。方式/仕様は結果を示して再検討する。
- P1: 予定登録拒否/結果不明/receipt保存失敗では解除呼出しがないことを障害注入で確認。登録成功後・有効化前、解除後・結果commit前のkill、旧予定取消失敗、古い/重複callbackを確認する。「解除成功／予定登録失敗」は通常フローで禁止し、既存の不整合を注入した復旧試験では保護予定未確認のgrantを解除根拠から外して即時再制限を試み、失敗はUncertainと表示する。
- P2: 12:00〜12:05のgrant中、12:01に12:03開始の上位ruleを追加する。短縮の事前確認、新予定登録後の有効化、UI/保存実効期限/OS予定の12:03一致を検証する。登録失敗時は旧有効policyと12:05期限/予定を保持。競合更新・短縮後に切替を削除した場合も検証する。
- writer lock保持中のkill/OS操作/Extension時間予算を確認。短い同期Adapterで成立しなければADR 0005/0006を再検討する。
- private理由保存とshared intent/履歴outboxの間で中断し、重複・成功誤認・本文漏えいがないことを確認。
- 第三者の制限と自分のstoreを区別し、own-store readbackでOS全体の制限成功と誤表示しない。
- 再認可後の本人承認、期限精度、DST/時計変更、OS再起動後の最初のアンロック前を検証条件に含める。
- 容量80/100MiB・outbox1万件は設計提案値。実ファイル/WAL増加・処理時間・復旧を測定し、しきい値をレビューする。
- 画面往復100回でstack/購読/timerが増え続けないか測定する。

必要な公式資料の確認先: [SQLite transactions](https://www.sqlite.org/lang_transaction.html)、[SQLite WAL](https://www.sqlite.org/wal.html)、[App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups)、[File Protection](https://developer.apple.com/documentation/foundation/fileprotectiontype)、[FamilyControls](https://developer.apple.com/documentation/familycontrols)、[ManagedSettings](https://developer.apple.com/documentation/managedsettings)、[DeviceActivity](https://developer.apple.com/documentation/deviceactivity)。旧セッションでは取得がプロキシ403だったが、2026-11-07 JSTに新環境からApple公式資料へ接続し、認可・token失効・名前付きstore・監視区間最小15分等を確認した。確認範囲と未確認の短期限表現/配信精度は[実機PoC手順](../ios-device-poc.md)へ記録する。資料確認を実機成功へ読み替えない。
