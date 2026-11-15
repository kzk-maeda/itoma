# 操作履歴の閲覧・削除

対象: #57の操作記録 / #132 / PR #133。ADR0006で採用した理由・操作履歴を通常画面へ接続する。設定時間の固定累計・週月集計は #96〜#100 の別契約であり、この画面は過去のpolicyや実利用時間を再構成しない。

## Nativeと画面の境界

`ItomaNative.apiVersion=1` / `historyVersion=1` / `history(action,payload)` を使う。既存Screen Time bridgeとは個別に利用可能性を判定し、古いbinary/Web/未構成を空の履歴と表示しない。Family Controlsの許可を要求せず、許可取消後も読み取れるprivate記録は閲覧・削除できる。理由本文は本人が選んだ1件だけを返し、一覧には含めない。app実名/token/raw errorは返さない。

| action | 処理 |
| --- | --- |
| page | 操作は同じcontrol source＋commandを1件にまとめ、理由は理由ごとにmetadataを最大40件。日時＋UUIDの前後keyset、private revision、日付条件、取得zone/as-of、容量と取込状況 |
| reason | command参照から、保存済み理由・削除済み・保存のみ・受付不明等を返す。本文はURL/イベント/logへ出さない |
| import | 最大500件の既存outboxを明示取込。private commit後にshared ack。予定登録や制限変更は行わない |
| deleteReasons | 本文のみ削除し、ID/元時刻のtombstoneを保持。操作履歴・ルール・現在grantは保持 |
| deleteHistory | 共有cutoffを読み、その後private writerで操作payload/理由を削除。古いoutboxで復活させず、cutoffより新しいeventは保持 |

一覧の操作カードは本人の操作単位。同じcontrol source＋command IDの受付・処理結果・grant変更を1件にまとめる。内部のimmutable eventは削除せず、`history()`の監査用読取には全eventを残す。理由タブは従来どおり理由1件ごとで、一覧へ理由本文を複製しない。

カードの日時/並び/日付絞込には保存sequenceが最初のeventの時刻を使い、状態/解除上限には最大sequenceのeventを使う。時計が戻っても新しい状態を古い状態へ戻さない。取込順が逆の場合も同じ規則を使う。日付またぎの終了・再制限で過去の操作を別日に移動しない。`updatedAt`で最後の記録時刻を別に示す。最初のeventが欠損/削除済みの場合は残存する最初の記録が起点であり、要求時刻を推定しない。異なるsource、別command、確定前の取消はそれぞれ別件。同じ理由文だけでまとめない。

40件の前後keyset/日付条件はまとめた索引へ適用し、各ページを取得した後のTSによる重複除去は行わない。`grouping=command`を返すnative応答の画面に、まとめ方と保存済みの最新状態を説明する。古いbinaryの未指定応答をまとめ済みと説明しない。

表示する状態は保存された操作の事実。`succeeded`は操作処理の記録であり、全OS制限や利用可能性の測定ではない。Pending/Failed/Uncertainとgrantの状態を分ける。確定前の取消はID/時刻だけを保存し、本文を保存しない。通常解除previewの明示取消もこの記録へ接続する。取消記録の保存失敗は共有の保守的な欠損フラグへ記録を試み、解除は行わない。

日付はGregorianのYYYY-MM-DD、取得時の端末zoneで日初〜翌日初の半開区間にする。DSTの23/25時間の日を24時間に固定しない。cursor/理由取得は取得時のprivate revisionとzoneを渡す。更新・削除・timezone変更は`changed`とし、先頭から明示再読込する。全範囲/日付選択と戻る位置はRAMで保持する。将来の週月画面からは`HistoryProvider.choose(kind,day)`と固定routeへ接続できるが、集計tokenとの一致は #96/#100 の採用・実装まで未接続。

## private schema5と処理の所有者

理由/操作payloadの既存表、raw検索用`history_read_index`と単調増加`history_read_state.revision`を維持し、schema5で表示用`history_choice_index`を追加する。command/source、最初と最新のevent参照・sequence・最初の時刻だけの派生metadataで、本文・token・payloadを複製しない。取込/cancelと同じprivate writer transactionで更新する。部分削除では生存eventから有界batchで索引を作り直し、古い削除済みoutboxの再送では復活させない。索引にはkind/不透明ID/時刻だけを保存し、理由やtokenを複製しない。共有Control schema6、monitor schema1は変更しない。ExtensionはItomaHistoryをimportしない。

schema1〜4はhostが明示的にmigrationし、索引作成/backfill（100 eventずつ）/version更新を単一writer transactionで行う。破損・未知schema・中断では元データを初期化せずrollbackする。schema5を古いbinaryへ戻して読めるという保証はない。downgrade時にDBを削除して対処しない。

private I/Oは専用`ProductHistoryController` actorが所有する。閲覧・初期化/移行・理由保存/受理・取消・取込・削除まで同actorへ送り、Control actorはawait中に停止処理を受け付けられる。共有受理には既存CASを使い、停止等で前提が変われば古い解除要求を拒否する。private/sharedのwriterを同時に保持しない。保存接続は再利用し、画面往復で接続を増やさない。

open/移行は全件検証で総量O(n)。理由/dummy/eventの検証/backfillは100件単位で読み、全本文配列を一度に保持しない。APIはmetadataを1回40件まで返す。#206のタイムラインは、本人がスクロールして取得した成功ページのmetadataを保持し、FlatListで描画を仮想化する。本文は明示的に開いた理由1件だけ。全件を初回取得せず、初期8件/windowSize5/batch8は測定の出発点であり、RAMは読み込んだmetadata量に比例する。大容量のページ窓/上限と実機RAM予算は未決定で、仮想化だけで一定容量を保証しない。理由の最大長P06をここで新規採用せず、現行の保存byte制限を使う。極端に大きい単一理由の表示と実機最大容量の計測は未検証。

`HistoryProvider`は取得世代で旧応答を棄却する。履歴側削除は先に表示を消し、設定側の理由削除はepochで既存本文/ページを隠す。削除前の遅い応答を表示し直さない。背景で本文を閉じ、前景では有界の再取得を行う。履歴用の秒timerはない。読取やimportの失敗を空/成功へ変換しない。

privateはComplete保護、backup除外の親ディレクトリへ置く。共有記録は既存App Group。File Protection、同時実プロセス、端末ロック、実機移行は対象buildで別検証する。ファイルを消して回復した扱いにしない。

## 容量と欠損の意味

- 論理payloadは保存内容の量。警告/上限はownerの明示build入力であり、80/100MiB等を出荷既定値にしない。
- DB/WAL/SHMは各ファイル長の観測。端末全体の使用量/空き容量や物理blockの測定ではない。未観測を0とせず、UIでは全て取得できた場合だけ関連ファイル合計を示す。
- 削除はアプリ上の論理削除で、ファイル縮小・WAL/backupからの法科学的消去は保証しない。
- private/共有の保守的な`historyIncomplete`、未取込、取込状況不明を分ける。再取込後に未取込がなくても、過去の欠損を補完できたとは表示しない。
- privateのページ/容量は同一read transaction、共有pending/gapは別の短いsample。二つのDBの全状態を同時刻に観測したという意味ではない。

検証・画像・実機への引き継ぎは [QA記録](../qa/history-records.md)。


## 振り返り・タイムライン・詳細の本体接続（#206）

本人了承済みの[Issue206](https://github.com/kzk-maeda/itoma/issues/206)と固定デモ `da5d462a295366423cdfd43ea11b45ca8e2f2897` の画面設計を採用する実装。PR193のnative計測DTO/proofScopeとPR209の要求単位索引を維持し、Web専用provider・比較切替・fixtureを本体へ追加しない。

- 振り返り上部は「集計を更新」。更新は現在の週/月/clipを維持してtokenを解放し、同じ画面の上下を再取得する。失敗時は「集計を再読み込み」。最下部の全期間入口は、遷移前に `choose('event','')` で日付/kind/参照/ページ/選択理由を消す。
- 日別も同じ `/history` を `chooseReflectionDay` のrevision/asOf/zone参照付きで開く。週/月/clipの記憶は振り返りProviderが保持する。
- 履歴は単一の仮想リスト。ヘッダーに条件/Notice、フッターに追加読込・補足・保存状況を置き、同方向のScrollViewへ入れ子にしない。操作と理由はnativeの別索引のまま。日付は取得zoneのGregorian日で表示し、前後日はcivil dayで動かしてnativeへ日文字列を渡す。
- 継続ページは同じquery・revision・zoneだけを追加する。同じcursorの同時要求を拒否し、後退しない/循環するcursor、進むcursorを持つ空または重複だけの応答はエラーで止める。追加失敗は旧カードを残して手動再試行へ。実際の末尾はnativeのnextなしで判断する。
- source/client・epoch・日付/kind・更新・削除・changedで旧世代の応答と選択を無効化する。理由の読取中と背景/詳細離脱では継続読込を停止。foregroundは先頭から再検証する。詳細から戻るだけなら先頭を読み直さず、同じページとスクロールoffsetを使う。
- `/history-reason`は「選択の詳細」。同じ世代の取得済みの行そのものを選択して開き、本文はその操作後の1件だけ取得する。戻る・背景・削除・source変更で閉じ、遅い応答を復活させない。
- 現行DTOに当時のアプリ名/ルール名/目的/希望分数はない。汎用の見出しと不足説明を使い、現在設定や期限差で補わない。理由のない操作にも詳細を用意し、削除/欠落/保存のみ/受付未確認を分ける。全event経過のqueryは追加しない。

`reconciled`は期限到来だけでなく早期終了にも使われるため、デモの「期限後の切替」から「再制限への切替を記録」へ文言を調整する。全grantStatusを明示的に表示し、元commandのsucceededでpending/scheduling/applying/activeを隠さない。failed/uncertain/reblockPendingも、元commandの成功や期限表示で隠さない。カードの重複選択は同期ガードで拒否し、理由read/詳細pushを一度だけにする。

実機・最大文字・VoiceOver・大容量RAM/ページ窓の受入は #131/#135 と分けて記録する。累計の単位変更は #213、当時の文脈のimmutable保存と取得は別契約。今回のJS画面接続でnativeのschema・制御・保存/削除規則は変えない。
