# 保存・共有・プライバシー

状態: **採用済み・実装/実機未検証**（[PR #36](https://github.com/kzk-maeda/itoma/pull/36)、2026-11-06 JSTにmainへマージ）。[了承コメント](https://github.com/kzk-maeda/itoma/pull/36#issuecomment-6685704584)。Issue [#25](https://github.com/kzk-maeda/itoma/issues/25)、[ADR 0006](../adr/0006-local-storage-and-history.md)。端末での保存・移行・保護は未実装・未検証。

利用者合意: 確定設定・対象・絶対解除期限を保持し、将来の履歴用に**解除理由本文と取得可能な操作記録も保存**する。破損時に黙って全消去しない。履歴UI・詳細分析・同期・バックアップ機能は後続。「理由を保存しない」という旧案は採用しない。

## 方式比較

| 案 | 長所 | 課題 | 提案 |
| --- | --- | --- | --- |
| UserDefaults/App Groups preferences | 小さな値の保存が簡単 | 複数値・操作台帳・履歴・移行・競合の一貫性を別実装する必要 | UIの無害な表示設定以外の正本にしない |
| JSONファイル＋原子的置換 | 人が追いやすく小さいsnapshotに向く | プロセス間排他、イベント追記、移行、検索を自作 | export/検証fixture候補。正本は別方式 |
| **ネイティブSQLite＋薄いRepository** | transaction、版管理、重複抑止、共有プロセス対応を明示できる | 接続/lock/保護/復旧/OS副作用は自分で設計が必要 | 推奨。iOS標準SQLiteを使う案。新しいJS DB依存を必須にしない |
| SwiftData/Core Data | オブジェクト管理と移行支援 | Extension共有・競合・asyncとの対応が別途必要、Swift学習の範囲増 | 今は採用せず、必要性が出たら再比較 |

WAL＋短いwriter transactionを第一候補とする。WAL自体が複数writerを同時成功させるものではない。iOSのプロセス停止・共有container・ファイル保護との組合せは実機PoC必須。SQLiteの適用可能性を理由にOSとのatomicityまで保証しない。

## 保存境界

| 場所 | データ | 読み書き |
| --- | --- | --- |
| App Groupのcontrol.sqlite | 有効PolicySnapshot、Pending候補policy、opaque Selection、Activation、Command、Grantの初期/実効期限、DeadlineRegistrationのreceipt/世代、Evaluation/Observation、操作台帳、履歴転送outbox | 本体と必要なExtension。理由本文なし |
| 本体privateのhistory.sqlite | 理由本文、ダミー金額選択、自アプリ操作/成否/取消/エラーの履歴 | 本体のみ。Extensionに読取APIを設けない |
| 画面メモリ | 未反映Draft、未送信理由 | ViewModelのみ。破棄承認後は保存しない |

ruleID/commandID/grantID/eventIDはランダムID。opaque native tokenはSwiftでencode/decodeし、TSにはselectionRefと表示に必要な最小DTOを渡す。対象アプリ名の生文字列や外部識別子を復元できる前提にしない。

理由本文を共有DBにまとめる案は単純だが、OS制限に不要な本文へExtensionもアクセスできてしまうため分ける。この2保存先はtransactionを共有できず、以下の受渡しを必要とする。

## 理由と履歴の受渡し

1. 本体private DBへ、本人が反映した理由とlogical commandIDをPreparedとしてcommitする。空白判定後の本文を保存し、入力途中/確定前に取消した本文は保存しない案。
2. private DBのtransactionを閉じてから、共有DBへ本文を含めない解除intentとcommandIDをcommitする。
3. [共通プロトコル](architecture.md)で期限予定を登録してreceiptを保存し、前提を再確認してから解除を適用する。登録失敗/不明なら新解除は行わない。共有outboxへ成否のメタデータeventを追記する。
4. 本体がoutboxをprivate履歴へ取込み、eventIDのUNIQUE制約で重複排除。private commit後にだけ共有outboxへackする。privateと共有のwrite lockを同時に保持しない。
5. 本体起動時にPreparedと共有commandを照合。共有受理がなければ未完了として記録し、解除成功とは扱わない。確定した操作に理由を後付けで推測しない。

取消イベントは種別と時刻だけ保存し、取消した本文は残さない。受理したが適用失敗した理由は操作の事実として残し、成功履歴と混同しない。Extension由来イベントは理由を読まずcommandID/grantIDで関連付ける。

## 初版の保持・容量の提案

自動期間削除なし・本人削除・容量警告/新規payload停止の方針は[了承済み](https://github.com/kzk-maeda/itoma/pull/36#issuecomment-6685704584)。**80/100MiBは実測後に確定する暫定値**で、outbox上限1万件も実測前の暫定候補とする。

- 自動の期間削除を初版では行わず、本人が履歴/理由を削除できるようにする。永久保存やアンインストール後復元は保証しない。
- 理由と履歴payloadの論理容量を合算し、80 MiBで警告、100 MiBで新規payload保存を停止して削除を案内する案。DB/WAL/復旧用snapshotの実ファイルサイズは別途計測し、これを端末全体の使用量上限と誤表示しない。閾値は実機測定後に見直す。
- 過去の本文を黙って削除/切詰めしない。理由必須の解除で本文を保存できなければ明示的に失敗とし、未記録の解除を成功表示しない。
- 自動再制限・本人による停止など、制限状態の回復を履歴保存の成否で阻害しない。記録できなかった場合はcontrol側にhistoryIncomplete/gapを残して表示する。端末全体の容量不足でcontrol保存も失敗する場合はOS操作結果を含め不明として扱う。
- outboxはack済みを削除。未ackは1万件を警告/上限候補とし、超過時は履歴欠損を明示する。無制限なExtension記録を行わない。履歴の完全性より期限後再制限を優先する。

「将来、捻出した時間を表示したい」は、今保存する自アプリ操作だけから実利用時間・生産性を推定できることを意味しない。実際に取得したデータ範囲を記録する。

## 版管理・更新・復旧

- 各DBにschemaVersion。policyRevisionは設定の競合検出、ruleVersionはgrantの有効性、eventIDは取込の重複排除に使う。
- 書込はtransaction内、OS副作用は [architecture.md](architecture.md) のdurable intent/予定receiptと照合する。候補policyを有効snapshotへ混ぜず、非同期の予定登録はwriter lockの外で行う。最終TXでbase revisionと確認済み影響を再検証し、実効期限・有効policy・結果をcommitする。
- 移行は本体が共有writer lockを取りtransactionで行う。Extensionは対応schema範囲を確認し、未対応なら書き込まずunknown/errorを残せる範囲で報告する。
- 新版schemaを読めない旧ビルドへロールバックしても勝手にdown-migrate/初期化しない。互換範囲と復旧手順を変更PRに記載する。
- 共有DBには直近の検証済みpolicy snapshotも保持。ただしDB全体破損からの復旧を保証しない。DBを開けない場合はOSを推測で変更せず、エラー・本人の復旧選択へ進む。
- 明示的な復旧は「直近設定の再適用」「自分のstoreの制限停止」「データ初期化」の影響を提示し、確認後に行う。OS側の停止も失敗し得るので成功を仮定しない。古いsnapshotからgrantを再付与しない。

## 保護・削除・機微情報

control DBは初回端末アンロック後のバックグラウンド参照が可能なFile Protection、private DBは端末ロック中に本文を読めない保護を候補とする。WAL/SHM等の付随ファイルも含め適用と実機確認が必要。保護で読めないことを空DBと扱わない。端末再起動後・最初のアンロック前の制限は #26 の確認条件とする。

OSのファイル保護を使い、独自暗号方式を追加しない。これは侵害された端末への絶対的な秘匿保証ではない。理由・token・証明書等をログ、エラーメッセージ、PR、デモ、外部分析へ送らない。

最低限の履歴/理由削除・容量状態・復旧の操作は初版の保存機能の一部として提案し、詳細な履歴閲覧/分析UIと分ける。

DB/付随ファイルをOSバックアップ対象から除外する案。これは独自同期の不採用だけでは自動的に成立しないので、実装時にバックアップ属性も検証する。端末移行/アンインストール後復元は初版対象外とし説明する。

- 履歴/理由の削除は制限設定を変えない。未反映outboxは削除cutoffを記録し再取込で復活させない。本文参照が残る場合は削除済みを表示。
- ルール削除は先に影響と残るルールを提示し、OS再評価を伴う。履歴はrule snapshotを最小保持し、削除済みruleと表示する。
- 全初期化は自分のOS制限・予定・共有DB・private DBの処理が分かれるため、部分失敗を表示。停止を記録し自分の制限停止の反映を確認してから予定取消・台帳の整理へ進む。失敗/不明なら復旧用intent/receiptを消さず、古いcallbackでも停止済みruleを再適用しない。途中で成功と見せず、次回も復旧できる手順にする。

## 検証仕様

| ID | 条件 | 期待 |
| --- | --- | --- |
| S01 | 本体とExtensionが同時更新 | writer直列化、古いrevisionで上書きしない |
| S02 | 共有intent直後/OS操作直後/結果commit前にkill | 再起動時にPending/不明を復元し、grant期限を延長しない |
| S03 | private commit後・共有intent前にkill | Preparedが残るが解除成功にならない |
| S04 | 履歴取込commit後・ack前にkill | 再取込しても1event |
| S05 | DB破損/未対応schema/端末ロック中 | 空設定として上書きせず、状態と本人の復旧操作を提示 |
| S06 | 理由/履歴削除後に古いoutboxを処理 | 削除したデータを復活させない |
| S07 | 容量/lock/履歴障害 | 解除の未保存を成功にせず、再制限・停止を履歴障害だけで妨げない |
| S08 | private/shareのバックアップ・端末ロック | 対象ファイルと付随ファイルの保護を実機で確認 |
| S09 | 予定API拒否/結果不明、receipt保存失敗 | 新解除なし。旧有効policy/期限/予定を保持し、候補は未反映と表示 |
| S10 | intent保存・予定登録・receipt保存・最終OS操作/commitの各境界でkill | 候補と有効設定を区別。未確認解除を成功扱いせず、残るcallbackは最新有効状態で評価 |
| S11 | 旧予定取消失敗・古い/重複callback | 新しい実効期限を延長せず、grant復活・停止済みruleの再適用なし |
| S12 | R11の短縮登録中に競合更新、または登録失敗 | 有効化時にbase/影響を再検証。失敗時は旧policy/12:05期限/予定を保持し、候補12:03を現在残時間として表示しない |

本表全体を実施済みとは扱わない。SQLite・File Protection・App Groupsの現行公式資料は実装前に確認する。初期設計時はSQLite/Apple公式ページがプロキシ403で取得できず、API/動作の確認を残していた。

## control保存Packageの実装範囲

[#69](https://github.com/kzk-maeda/itoma/issues/69)の[ItomaStorage](../../packages/itoma-storage/README.md)で、SQLite公式GitHubのC API仕様を確認し、明示的な新規作成/既存DBのopen、schema/application ID、WAL、snapshot/Selection/Activation、snapshotSequenceのCASを実装する。CoreからSQLite依存を分離し、JSON policyの検証とSQLの版列を照合する。Selection refは不変とし、対象編集は新refを候補ruleへ束縛する。

一時SQLiteのS01のwriter/CAS部分とS05の破損/未対応版をテストする。command/候補は#70、grant/receiptは#71、履歴/outboxは#46、実行順序は#47。iOSリンク・App Groups・端末ロック・File Protection・バックアップ除外・実プロセスkillは#49へ残し、Linuxの単体成功を実機の証拠にしない。DB異常時に空設定で復旧したことにも、制限を停止できたことにも扱わない。

[#70](https://github.com/kzk-maeda/itoma/issues/70)でschema2へcommand/attempt/Pending候補を追加する。schema1からの移行は本体が明示してwriter TXで行い、Extensionは勝手に移行しない。受理時は有効policyを保持し、最終CASでlast-valid/new policyを一緒に更新する。同IDはdecoded intentの構造で照合し、Cancelled等の終端や同attemptでの失敗再実行を拒否する。同期writer scopeは終了後に使えず、個別操作の失敗を捕捉してもrollback-onlyを解除できない。D02/D03とS02の保存/rollback部分は一時SQLiteで検証し、実OS副作用とプロセスkillは後続の証跡に分ける。

[#71](https://github.com/kzk-maeda/itoma/issues/71)のschema3でgrant・登録世代/receipt・commandの解決先grant参照と候補有効化記録を追加する。同対象に合流した別commandも結果を固定し、終端後の再送で新しい期限を作らない。初期上限とidentityを維持し、非終端の短縮は候補確認と登録照合を伴う原子的更新へ限定する。過去の終端`hasEnded`も保存し、再制限のUncertain/Failedから解除へ復帰させない。

Preparing、外部受理/発火事実、最終適用のcommit境界を分け、同TXでの迂回を拒否する。複数grantの短縮は全登録が揃った時だけpolicyと一括commit。D03/D11/D12、S09/S10/S12のRepository部分は合成receiptと一時SQLiteで検証し、実API/OS成功・kill・iOS保護とは区別する。

## 本体private理由の実装範囲

[#79](https://github.com/kzk-maeda/itoma/issues/79)の[`ItomaHistory`](../../packages/itoma-storage/HISTORY.md)は共有controlとは別product/別DBで、本体だけがimportする。SQLite技術層を共通targetへ分離し、Extension向け`ItomaStorage`に本文APIの依存を作らない。schema1は理由本文UTF8 BLOB・reasonRef・commandID・Prepared時刻・論理bytesを保持する。非空白判定にCoreを使い、判定後も原文を保持する。

同identity/同UTF8の再送は元のPreparedを返し、別本文を拒否する。本人削除後も本文なしのidentity tombstoneを残し、再送で復活させない。容量閾値は注入し、原文payloadと実ファイルサイズを分ける。Preparedは共有受理や解除成功の証拠ではない。S03/S07のprivate単体部分を一時SQLiteで検証し、共有outboxとの順序・取込・削除cutoffは[#80](https://github.com/kzk-maeda/itoma/issues/80)、実機の保存先/保護は#49に残す。

[#80](https://github.com/kzk-maeda/itoma/issues/80)でcontrol schema4/private schema2へ明示移行する。型付きcommand/grantのoutboxをprivate commit後にだけackし、payloadは削除、eventID/sequenceの冪等台帳は維持する。private commit後/ack前の再実行、sourceID別の削除cutoff、境界後の新eventの保持、容量/INSERT失敗による全rollbackとack抑止を一時SQLiteで検証する。取消recordはID/時刻だけで本文を持てず、確定ダミー選択の保存はUI金額の採用や決済ではない。

`acceptReasonGrant`はprivate Preparedを閉じてから共有intentを受理し、private失敗で共有grantを作らない。outbox満杯/履歴障害はcontrolのhistoryIncompleteへ残し、履歴のためだけに停止/再制限のmetadataを失敗させない。実OS副作用は#47以降、iOSの保護・2プロセスのkill/lockは#49。S03/S04/S06/S07のDB単体部分と実機ゲートを分ける。

## ルール名・行動目標（#147）

本人の文章をhost-onlyの独立`RuleDetailsRepository` / `rule-details.sqlite`へ保存する。共有Ruleや既存control/history schemaは変更せず、名前/目標だけの保存でOS予定やgrant期限を変えない。native `saveRuleDetails`とsnapshotの`ruleDetailsStatus`/`ruleDetailsRevision`を使用し、旧nativeでは編集を有効化しない。詳細は [保存契約](rule-details.md) を参照。新しいnative buildでのiOSリンク/Complete保護/端末UIは別に確認する。
