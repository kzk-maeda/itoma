# ADR 0012: 当時のルール設定と解除ログから時間を再計算する

状態: **本人指定に基づく設計・実装のレビュー対象**（2026-11-19 JST）。関連 [#98](https://github.com/kzk-maeda/itoma/issues/98)、#219 / #222。本人の「ルール設定と解除ログから再計算するロジックで実装を修正して」が今回の方式変更の根拠。PRの人間レビュー/マージと実機受入は別で、ここでAcceptedや実機合格を宣言しない。

## 定義と理由

以前のnativeRecordedIntervalsは、適用/own-store確認を繋ぎ、不明checkpointで区間を落としていた。予定4時間に対して1時間35分など、認可取得不能や確認の欠測による過少計上が起こり得た。本人は、実行記録を継続観測して積む方式から、ルール設定と解除ログによる計算への変更を指定した。

新指標は **`rule-schedule-excluding-unlocks-v1` / `ruleScheduleLogs`**。OSの継続遮断・実利用・集中の実測とは区別する。計算はSwiftで行い、TypeScriptは表示と入力検証だけに使う。ADR0007/0010/0011の旧qualificationを新しい算出値の条件にしない。生の認可、制限制御、P1/P2、実際のOS適用判定は変更しない。

```text
算出時間 = union（当時の有効ルールの対象がある時間帯）
         − union（成功した一時解除の期間）
         − 停止・再認可確認待ち・ログ欠落/時刻逆行の期間
```

## 再構成の規則

- 共有/本体に保存済みのReflectionControlFactには当時のpolicy・優先順・対象ref・Activation・grantがある。現在policyを過去へ当てはめず、各状態のcommit時刻で区切る。旧point/native記録も、この設定情報を使って**新指標として**再計算する。旧記録をOS成功へ書き換えない。
- enabledかつ有効対象があるルールだけを計上する。重なるルール/複数アプリは経過時間として一度だけ加算する。曜日・開始日基準の日跨ぎ・DSTは共通RuleEvaluatorのoccurrence列挙を使う。評価用のapprovedを捏造せず、OS適用向けdesiredTargetsゲートを使わない。
- 停止・awaitingReauthorizationConfirmationは記録時刻で切り、resume後から再開する。認可unknown/own-store不一致だけで、設定・操作ログの揃った時間帯を落とさない。
- grantのactive成功が記録された時刻から、固定expiresAtまたは早期終了/失効の記録時刻まで控除する。一部アプリだけの解除も全体から控除し、重複解除はunionとする。pending/scheduling/明確なfailedは成功した解除として控除しない。
- active後のuncertainは既知の解除として期限まで保持する。成功が一度も記録されていないapplying/uncertainは、その解除候補の有効範囲だけgapとする。成否不明を成功へ昇格させず、4時間全体を欠測にしない。
- 当該target・rule/version・occurrence開始・zoneを照合し、終了/高優先度winnerへの切替でgrantを打ち切る。高優先度ルールが終わっても古いgrantを復活させない。
- 解除期限やルール終了のcallbackがなくても、記録された期限/予定終了で計算を切る。再制限の実行成功を待つ旧metricとは異なる。これはOS再制限が成功したという宣言ではない。
- 最後に記録されたpolicyは固定as-ofまで評価できる。未取込/欠落の新しいログがあると分かっているsourceは、最後の取込時刻から先をgapにする。取込を完了してから再計算し、未取込の停止/解除を古い設定で上書きしない。
- sourceごとにsequenceで処理し、欠落区間を除外する。sourceが置換された場合は新sourceの開始時刻で旧policyの外挿を止める。commit時刻の逆行はgap。uptimeやnative checkpointの成否には依存しない（端末再起動や旧版のsleep時計で設定時間を消さない）。zone変更はその記録時刻で旧zone/新zoneを切り替える。
- 最初の保持ログ以前や全記録削除以前を補完しない。削除cutoff/遅れた旧batchの非復活を維持する。理由・操作履歴だけの削除で時間記録を消さない。

## 保存・性能・画面

製品DB schemaの変更なし。既存のimmutable logを100件ずつ読み、同じ内容のcheckpointをまとめる。31日ずつ暦を展開し、導出intervalに上限を持つ。connection内projection cacheはledger revision・SQLite data_version・future log/as-ofで検証する。現在の累計と週/月は同じtoken/as-of。旧metric tokenはchangedとして読み直す。

集計前のnative baselineはpolicy/Activation/grantの記録だけを原子的に採取する。Shield読戻し/権限取得を集計の前提にせず、OS適用や予定登録はしない。旧native duration向けの成功sampleを生成せず、その任意schemaの導入も集計の前提にしない。

画面見出しは「ルールから計算した時間」。説明は「設定したルールの時間から、一時解除と停止の時間を除いて集計しています」。累計固定・週/月の構成は維持する。DESIGN原則1/3/4/5、RF01〜RF09、UI22〜UI25。新metricを既存の「制限の適用を記録した時間」と取り違えない。

## 検証と限界

4時間−5分=3時間55分、重複ルール/アプリ/解除、早期解除終了、失敗、期限後callbackなし、停止/resume、過去policy変更、日跨ぎ/曜日/DST、zone、欠落・時計・旧ログ再計算・削除・token/取込を合成native/SQLiteで検証する。新Swiftを含むbuildと実機の確認は別に記録する。

OS適用失敗・未観測の認可取消・電源off・ログに残らなかった変更をすべて検知する仕組みではない。時計の前進も設定の時刻に基づく計算へ反映され、実経過時間との差はあり得る。端末を閉じていても予定上の時間は計算する。過去の設定・解除ログが欠けている期間の正確な復元はできない。大容量での実機性能と通常制御の実機QAを、方式変更だけで完了にしない。
