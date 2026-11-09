# 操作履歴の閲覧・削除

対象: #57の操作記録 / #132 / PR #133。ADR0006で採用した理由・操作履歴を通常画面へ接続する。設定時間の固定累計・週月集計は #96〜#100 の別契約であり、この画面は過去のpolicyや実利用時間を再構成しない。

## Nativeと画面の境界

`ItomaNative.apiVersion=1` / `historyVersion=1` / `history(action,payload)` を使う。既存Screen Time bridgeとは個別に利用可能性を判定し、古いbinary/Web/未構成を空の履歴と表示しない。Family Controlsの許可を要求せず、許可取消後も読み取れるprivate記録は閲覧・削除できる。理由本文は本人が選んだ1件だけを返し、一覧には含めない。app実名/token/raw errorは返さない。

| action | 処理 |
| --- | --- |
| page | 操作または理由のmetadataを新しい順に最大40件。日時＋UUIDの前後keyset、private revision、日付条件、取得zone/as-of、容量と取込状況 |
| reason | command参照から、保存済み理由・削除済み・保存のみ・受付不明等を返す。本文はURL/イベント/logへ出さない |
| import | 最大500件の既存outboxを明示取込。private commit後にshared ack。予定登録や制限変更は行わない |
| deleteReasons | 本文のみ削除し、ID/元時刻のtombstoneを保持。操作履歴・ルール・現在grantは保持 |
| deleteHistory | 共有cutoffを読み、その後private writerで操作payload/理由を削除。古いoutboxで復活させず、cutoffより新しいeventは保持 |

一覧は操作時点のimmutable事実。`succeeded`は操作処理の記録であり、全OS制限や利用可能性の測定ではない。Pending/Failed/Uncertainとgrantの状態を分ける。確定前の取消はID/時刻だけを保存し、本文を保存しない。通常解除previewの明示取消もこの記録へ接続する。取消記録の保存失敗は共有の保守的な欠損フラグへ記録を試み、解除は行わない。

日付はGregorianのYYYY-MM-DD、取得時の端末zoneで日初〜翌日初の半開区間にする。DSTの23/25時間の日を24時間に固定しない。cursor/理由取得は取得時のprivate revisionとzoneを渡す。更新・削除・timezone変更は`changed`とし、先頭から明示再読込する。全範囲/日付選択と戻る位置はRAMで保持する。将来の週月画面からは`HistoryProvider.choose(kind,day)`と固定routeへ接続できるが、集計tokenとの一致は #96/#100 の採用・実装まで未接続。

## private schema3と処理の所有者

理由/操作payloadの既存表は変更せず、検索用の`history_read_index`と単調増加`history_read_state.revision`を追加する。索引にはkind/不透明ID/時刻だけを保存し、理由やtokenを複製しない。共有Control schema6、monitor schema1は変更しない。ExtensionはItomaHistoryをimportしない。

schema1/2はhostが明示的にmigrationし、索引作成/backfill/version更新を単一writer transactionで行う。破損・未知schema・中断では元データを初期化せずrollbackする。schema3を古いschema2 binaryへ戻して読めるという保証はない。downgrade時にDBを削除して対処しない。

private I/Oは専用`ProductHistoryController` actorが所有する。閲覧・初期化/移行・理由保存/受理・取消・取込・削除まで同actorへ送り、Control actorはawait中に停止処理を受け付けられる。共有受理には既存CASを使い、停止等で前提が変われば古い解除要求を拒否する。private/sharedのwriterを同時に保持しない。保存接続は再利用し、画面往復で接続を増やさない。

open/移行は全件検証で総量O(n)。理由/dummy/eventの検証/backfillは100件単位で読み、全本文配列を一度に保持しない。画面はmetadata40件と明示的に開いた理由1件だけを保持する。理由の最大長P06をここで新規採用せず、現行の保存byte制限を使う。極端に大きい単一理由の表示と実機最大容量の計測は未検証。

`HistoryProvider`は取得世代で旧応答を棄却する。履歴側削除は先に表示を消し、設定側の理由削除はepochで既存本文/ページを隠す。削除前の遅い応答を表示し直さない。背景で本文を閉じ、前景では有界の再取得を行う。履歴用の秒timerはない。読取やimportの失敗を空/成功へ変換しない。

privateはComplete保護、backup除外の親ディレクトリへ置く。共有記録は既存App Group。File Protection、同時実プロセス、端末ロック、実機移行は対象buildで別検証する。ファイルを消して回復した扱いにしない。

## 容量と欠損の意味

- 論理payloadは保存内容の量。警告/上限はownerの明示build入力であり、80/100MiB等を出荷既定値にしない。
- DB/WAL/SHMは各ファイル長の観測。端末全体の使用量/空き容量や物理blockの測定ではない。未観測を0とせず、UIでは全て取得できた場合だけ関連ファイル合計を示す。
- 削除はアプリ上の論理削除で、ファイル縮小・WAL/backupからの法科学的消去は保証しない。
- private/共有の保守的な`historyIncomplete`、未取込、取込状況不明を分ける。再取込後に未取込がなくても、過去の欠損を補完できたとは表示しない。
- privateのページ/容量は同一read transaction、共有pending/gapは別の短いsample。二つのDBの全状態を同時刻に観測したという意味ではない。

検証・画像・実機への引き継ぎは [QA記録](../qa/history-records.md)。
