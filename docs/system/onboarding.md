# 初回設定・途中保存・再開（#118 / #149）

状態: 本人の2026-11-11実装依頼を具体化するレビュー対象の契約。設計Acceptedや実機合格の宣言ではない。基盤は採用済み#36のcandidate/commandと、merged #148の[ルール名・行動目標](rule-details.md)。視覚は#116固定版`5329bf2`のキャラクターOFF。デモの数値・保存方式は採用しない。

## 体験と情報の境界

導入→任意の名前/行動目標→曜日/時刻→明示的なスクリーンタイム認可/OS Picker→最終確認→結果→既存ホーム。キャラクター、会話UI、登録、通知要求は加えない。曜日/時刻は未選択から始める。時刻は端末の現地時刻、曜日は開始日。最終検証は既存`WeeklySchedule`の1〜1440分を使う。

起動時は認可を要求しない。許可・Picker保存・下書き保存・candidate準備では有効policyを変更しない。本人の最終確定だけで既存commandの実行を要求する。目的は任意、未登録ならホームの引用面を省き、サンプルを補わない。確定後の名前/目的は#148の設定画面で編集できる。

確認画面は名前と目的／曜日・時間／許可と対象の要約に分け、各見出しのそばに控えめな「変更」を置く。修正時は入力済みの値を表示し、「変更を確認する」または上部の戻るで確認画面へ直接戻す。他の入力stepは繰り返さない。不正な時間帯のまま戻った場合は修正を案内し、準備・確定はできない。最終確定を主操作、後回し・破棄を副次操作とする。[調査根拠と検証](../qa/onboarding-review/README.md)を参照。

## 保存

本体privateの`ITOMA-Private/rule-details.sqlite`に任意の補助表`onboarding_version(version=1)`と`onboarding_progress`（固定1行）を追加する。既存application IDと主schema version 1は維持し、旧readerの名前/目標保存を妨げない。未知/片方だけの補助schema、壊れたJSON、非正規counterは初期化せずエラー。旧storeのreadだけでは表を作らない。

- `seenIntro`、`completed`、任意のdraft、独立したUInt64 revisionのCAS。
- draft: 安定UUID、現在step、任意title/goal（#148と同じ80/1000 UTF-16単位、NUL禁止）、曜日、入力途中の時刻、翌日、任意のopaque selectionRef。
- 任意の`returnToReview`は確認から修正した場合のUI上の戻り先だけを保存する。schema-1の旧draftで欠落していればfalse相当。後回し/再起動後も修正から確認へ直接戻れるが、認可・対象確認・commandの成否はこの値から推測しない。
- 準備済みdraftのbinding: 安定command UUID、基準policy revision、本人が確定したか。Rule IDはdraft UUIDを使う。bindingがある間は入力を直接変更しない。
- `selectionReady`、現在command状態、`canEdit`はnativeがその時点で返す値で、永続フラグから認可・OS成功を推測しない。

Complete File Protection、バックアップ除外、ホストのみの保存。App Groups/Extension/履歴/URL/ログへ目的・名前・draftを渡さない。共有Ruleに個人文を追加しない。履歴削除と初回設定の削除は別。現在値を置き換え、入力履歴を追記しない。SQLite/WALの物理的な消去保証はしない。

入力はroot providerの1本のwriterで250ms後に保存。待ち行列は最新入力へ集約し、前の応答で新しい文字を戻さない。次へ/後回し/最終確認は保存完了を待つ。戻るや通常の離脱は保持し、明示的な「下書きを破棄」は確認後に削除する。失敗時は入力を保持し再試行できる。保存応答前の強制終了では最後の未保存入力を失い得るため、保存済みと断定しない。

## 確定・再開の順序

1. 許可と対象を確認する。端末再起動/プロセス再作成/認可取消後は以前のselectionRefをそのまま確認済み扱いせず、Pickerで再確認する。raw tokenはJSへ出さない。
2. 最終確認の準備時、command IDと基準revisionを**privateへ先に**保存。そのIDで既存candidateを受理し、影響をpreviewする。途中で落ちても同じIDを復元し、有効policyはまだ変えない。
3. 最終確定ではprivateに`submitted=true`を**先に**保存。失敗すればOS適用を要求しない。成功後、既存CommandServiceの実行/明示retry、予定準備、再検証、適用を使う。
4. bindingのcandidateが実際にactivatedになり、そのRule IDが有効policyに存在するときだけ、privateで名前/目標の保存と`completed=true`・draft消去を**同一transaction**で行う。後から本人が編集済みの個人文を上書きしない。明示的な空保存も本文なしの現在行として区別し、古い目的を復活させない。
5. policy commit後にprivate完了応答が失敗しても、次のreadは同じbindingの事実を照合し、privateの完了処理だけを再試行する。OS commandを再実行したり別Rule IDを作ったりしない。既に本人がruleを削除した場合も復活させない。

privateとshared DBの全体を1 transactionにはできないため、4は復旧可能な完了手続き。`completed`は初回導入を終えた事実だけであり、制限反映成功の証明ではない。結果画面/ホームは現在native snapshotの認可・Activation・予定・観測期限を別に確認する。保存済み/反映失敗・不明/次の予定/制限設定反映を区別する。

未activatedのpending/failed/uncertainなcandidateは、本人が編集を選ぶとpendingだけcancelしbindingを外して下書きへ戻せる。Scheduling/Applyingまたはactivatedの処理は編集・破棄でなかったことにせず、現在の結果確認/既存設定の停止・復旧へ案内する。一般的なreadは未確定candidateを実行しない。OS処理はViewを離れてもnativeが所有する。

## 初回判定と互換性

初めての対応iPhone・ルールなしの場合だけ導入へ案内し、先に`seenIntro`を保存する。後回しのホームには同じ設定への入口を1つ置く。既存ruleがありdraftがない利用者は導入済みとして移行する。完了後の認可取消は既存の再許可/選択/明示再開を使い、長い導入を再強制しない。旧nativeには`onboardingVersion=1`がないため新actionを送らず、読み込み不可と新buildの必要性を示す。Simulatorは実際の制限をせず、既存のホームとnative smokeを維持する。

## 検証の限界

Swift保存テストは耐久化・CAS・旧schema互換・一括rollback等。component/合成Webは入力・後回し・再開・確認の順序等。nativeの型/リンクとBridgeは変更を含む署名無しビルドで検証する。実際のFamily Controls/Picker、認可取消、kill中のOS処理、ロック時保護、VoiceOver/Dynamic Typeは本人が後日の実機QAで確認し、#118/#131へ記録する。
