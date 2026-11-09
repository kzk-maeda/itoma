# 設定時間の累計・週月集計契約案

状態: **Proposed / #96の人間による採用レビュー待ち**。UIとして了承された固定累計＋週次/月次を実データにつなぐための具体案。実装済み・採用済み・OS検証済みの宣言ではない。操作履歴 #57/#132 と、記録基盤 #97・集計 #98・画面 #99・統合 #100 を区別する。

## 採用を求める判断

| 論点 | 推奨案 | 根拠・代替 |
| --- | --- | --- |
| 計上するもの | **保存された有効設定に基づく、過去の時間帯区間の和集合**。対象が1つ以上ある区間だけ | 未来の予定を足す方式では、まだ経過していない時間で累計が増える。実際のOS遮断/集中/取り戻した時間は測れない |
| 複数ルール/対象 | 同じ時間は1度。アプリ数倍にしない | デモの重複排除と本人了承の情報設計を継承 |
| 一時解除 | 差し引かない | #98の契約。解除回数/時間は別の操作記録であり、この指標へ混ぜない |
| 有効/停止 | durableなActivationがenabledで有効rule/対象がある区間を計上。paused/再認可確認待ちは除外 | 許可/OS成功の測定に置き換えない。アプリが観測できない取消を検出済みと仮定しない |
| 記録開始 | 新しい記録方式を有効化したnative時刻から | 現在snapshot/旧解除eventから、未記録の過去policyを逆算しない |
| timezone | **記録したcontextに従うモデル値**。変更観測時は新epochとし、変更時刻が不明な過去区間をgapにする | 現在のzoneを過去全体へ当て直さない。未観測のzone往復を完全検出する保証はない。固定zone集計という代替は、live ruleの現地時刻追従とずれるため非推奨 |
| 削除 | 理由のみ/操作履歴のみの削除は累計を保つ。**全記録と累計の削除は別の明示操作** | #132の既存「操作履歴と理由」削除を、後から黙って累計消去へ広げない |
| 未確定/欠損 | 既知部分の合計＋partial表示。欠損/未記録を0へ埋めない | 平滑化や現在設定による補間を行わない |

推奨案で進めるには、このPRの人間によるレビューと採用が必要。先に実装した操作履歴の閲覧・削除はADR0006で進められるが、本案の記録・集計は採用後に着手する。

## 1. 計算の定義と例

計算の入力は、nativeが耐久commitしたpolicy/selectionの有無/Activation/contextの事実と、記録coverage。`RuleEvaluator`相当の採用済み曜日・日跨ぎ・DST規則をnative側で使う。TSに勝者や別集計式を作らない。

1. factの有効範囲を、次factまたはsnapshotのas-ofで切る。記録開始より前と未来を除く。
2. enabledのruleに対象があり、Activationがenabledである範囲から予定区間を展開する。編集commit前の設定を、編集後の時刻へ延ばさない。
3. gap/削除/未確定区間を除外し、UTCの半開区間でunionを取る。
4. 正確な秒数を合計し、表示時だけ時分へ丸める。アプリ数・解除分・丸めた日別値を足さない。

| 条件 | 期待する既知の設定時間 |
| --- | --- |
| 21〜23時、as-of21:45 | 45分。残り75分を先に計上しない |
| 21〜23時に21:30〜22:30の別rule/別対象を追加、as-of23:00以降 | 21〜23の2時間。アプリ数倍にしない |
| その間に5分解除 | 設定時間は変えない。解除は操作履歴で確認 |
| 22時に停止、22:30再開、23時終了 | 90分 |
| 21:30に21〜23を22〜23へ編集 | 変更前30分＋変更後60分＝90分 |
| 21:30〜22:15の記録欠損 | 既知75分＋partial。欠損を0/完全としない |
| 同じfactの再送/再取込 | 値は増えない |
| 61秒と59秒の2区間 | 120秒。表示済み「1分」「1分未満」を再加算しない |

表示は分未満を「1分未満」、分以上は切捨てた時分を使う提案。生の秒数は保持する。日別の丸め値の和と期間合計が異なる場合があるため、期間合計は必ずnativeの正確な合計を使う。

## 2. 記録する事実

旧command/grant eventは過去policyの全体を持たず、新集計の正本にできない。#97で必要最小の別ledgerを設ける案:

- `sourceID/eventID/sequence`、耐久commit時刻、policy revision、enabledな曜日/開始・終了/日跨ぎ、対象が存在すること、Activation、記録contextのzone/offset、context epoch。
- 初期化、policy確定、停止/明示再開、観測した認可によるActivation変更、nativeによるcontext変更を、対応するcontrol commitと同じwriterで記録する。
- 予定callbackだけを記録源にしない。JS停止後も保存済みfactから計算し、Extensionが観測したcontextはnativeで記録する。
- **reason本文、token、実アプリ名、privateな目的の文章を複製しない**。解除時間を差し引くためのgrant履歴も不要。
- 未確定candidate/previewを、確定policyのfactとして記録しない。

sharedの追加outbox→private ledgerの取込は既存のprivate commit→shared ack、eventID重複排除、短いtransactionを再利用する。control/privateのwriterを同時に持たない。将来のschema番号/DDLは #97 の実装PRで決め、現Control6/History3を本設計文書だけで変更しない。

履歴保存の失敗を設定/停止の成功に読み替えない。一方、追加ledgerのpayload失敗だけで安全な停止/再制限を止めない。source高水位とdurableなloss境界で未保存範囲を識別する。容量は既存の明示候補を勝手に倍増せず、combined pending上限やprivate payloadの計上を #97 で検証する。

## 3. coverage / context / as-of

coverageは`recorded / partial / not-recorded / deleted`を区別する。0秒を返すのは、その範囲の計算事実が揃い、該当する有効区間がない場合だけ。記録前/全削除後の未開始を0の成果に見せない。

- privateに取り込めたledgerと確認済みの高水位から`confirmedThrough`を決める。未取込があれば、後続factを未確認のまま現在まで確定扱いにしない。
- **取込遅延と実際のfact欠落は別**。既存の保守的なhistoryIncompleteだけから、欠損時間を推定しない。新ledgerではsourceのsequence/loss境界と、回復できたpendingを識別する。
- timezone変更を観測したら新context epoch。前回観測から変更観測までの不確かな区間はgapとし、変更が実際に起きた時刻を推測して過去へ書き込まない。
- 時計の逆行/大幅な不連続ではepochを切り、不確かな重なりをpartialにする。既知区間を二重加算しない。「累計が絶対に減らない」とは約束しない。
- 未観測のtimezone往復/時計変更を全て検出できる保証はない。このモデル値を実OS遮断時間と呼ばない。記録contextに基づく計算であることを詳細へ示す。

1回のprivate read transactionから、固定した`datasetToken={ledgerRevision,historyRevision,asOf,displayTimeZone}`を発行する。上部累計と下部期間は同じtokenで返す。新fact/削除/context変更でtokenが無効なら`changed`を返し、上部/下部を一緒に更新する。期間移動だけでは上部の対象範囲を変えない。

## 4. 週/月/日と有界DTO

表示zoneをtokenに固定し、Gregorian、週開始は月曜を推奨する。日付の境界はCalendarから求め、DSTの日を86400秒としない。zoneを変えたら全体を再取得し、古いcursor/tokenを使わない。

- 週: 月曜00:00〜翌月曜00:00、日別最大7bucket。
- 月: 月初00:00〜翌月初00:00、月曜区切りの週行を月境界でclip（最大6行）。月→clipした週→日の順で詳細化する。
- 上部累計: 利用可能な記録開始からas-ofまでの既知区間union。選択週/月には依存しない。
- 小さな推移: 全記録範囲の有界sample（最大64）。欠損は線を切り、0へ補間しない。TSへ全ledgerを渡さない。
- 各bucketは`from/until/localLabel/knownSeconds/coverage/rangeKey`を持つ。集計DTOに理由/アプリ実名/tokenを含めない。
- 一日の操作履歴は #132 の別API。historyRevision/as-ofが一致しない場合はその事実を示し、同時点だったと断定しない。理由本文は選択後にだけ取得する。

例: 月の最初の週が前月の月曜から始まっても、当月分だけを月合計へ入れる。月末/年末を跨ぐ週の全7日を、両月へ丸ごと加算しない。

## 5. 削除と再取込

| 明示操作 | 消すもの | 保持するもの |
| --- | --- | --- |
| 理由のみ削除（既存） | 理由本文 | 操作metadata、ledger/累計、policy/grant |
| 操作履歴と理由の削除（#132） | 操作payload、理由本文 | 対応するcutoffを記録・保持/更新。ledger/累計、policy/grant |
| 全記録と累計の削除（新しい明示操作案） | 上記＋ledger payload/集計cache/coverage | 全sourceのcutoffを記録・保持/更新。safety metadata/tombstone、policy/grant |

新操作は削除前に「累計も消える」ことを示す。既存ボタンの意味を黙って変更しない。sharedの各source高水位をlock外で取得し、privateの削除/cutoff/cache無効化を一つのwriterでcommitする。古いoutbox・旧token・画面cacheから復活させない。

全削除後は「削除後の記録なし」。有効設定を保ったまま新しいnative baseline factを記録してから将来分を再開する。baselineを書けなければ未記録として示し、削除前のpolicy履歴を持ち戻さない。異なるsourceIDへ古いcutoffを適用しない。SQLiteページ/WAL/backupからの法科学的消去は保証しない。

## 6. 後続Issueと受入ゲート

| Issue | main反映を確認してから行うこと |
| --- | --- |
| #97 | 本決定を採用後、ledger/schema移行/耐久write/coverage/loss/cutoffを実装。再送/失敗/kill/削除回帰、iOS build |
| #98 | union/clip/秒計算、同token累計＋週月DTO、有界SQL取得、空/partial/削除/大規模性能を検証 |
| #99 | 採用DTOのfixtureでGraphiteの固定累計＋週月、明瞭なcoverage、月→週→日、VoiceOver代替説明を実装 |
| #100 | typed bridge/ホーム入口/日別#132を接続、削除・取込更新・前景復帰でtoken整合、往復計測、対象native build |

本案の採用は本実装完了/実機合格ではない。記録開始前を含むデモの84時間・9/1等を本体へ固定しない。カレンダー、本人ノート、おたより、実課金、利用時間/集中の推定は採用範囲外。
