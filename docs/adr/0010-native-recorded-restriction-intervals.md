# 0010: native操作を追跡した制限区間を振り返りへ接続する

- 状態: **Proposed / 実装を含むレビュー対象**。ADR0007の実遮断qualificationをAcceptedへ読み替えない。
- 対象: #97 / #98 / #100。2026-11-15 JSTの本人の実装依頼。
- 指標: `native-restricted-excluding-unlocks-v2`、`proofScope=nativeRecordedIntervals`。

## 問題と測定範囲

現在の製品は操作の点を保存するが、制限時間を返さない。Appleの[ManagedSettingsStore](https://developer.apple.com/documentation/managedsettings/managedsettingsstore)はown-storeの設定とOSの実効挙動を区別する。公開API一覧・iOS27 release notesを再確認しても、Shieldが継続して実効だった秒数を直接取得するAPIは確認できていない。

今回提案する値は、nativeが制限の適用成功を記録してから、nativeの解除・停止・編集・再制限などを追跡した区間の時間である。**OS内部の遮断を常時観測した実測値ではない**。自身のstoreの適用確認、耐久遷移、同じ起動期間の単調時計、欠落検出を組み合わせた操作上の記録とする。この違いをUIとAPIに残す。

ADR0007の`restricted-excluding-unlocks-v1`へown-storeの点を正値として混入する案は採らない。新しいscope/metricの採用は本PRの人間レビューで判断する。旧point記録は数値なしを維持し、新方式の開始前を埋めない。この提案のレビュー前に実遮断指標の完成・実機合格とは扱わない。

## 実装

1. Control6のoptional reflection outboxを再利用する。hostがversion1の`reflection_duration_capture`を追加し、新しいhost/Extensionは同じ短いcontrol commitで`durationObservation`を記録する。旧writerが出すsampleなしのfactやsequenceの欠落は継続を切る。main schemaやOS予定・対象・grantを初期化しない。
2. sampleはUTC時刻・スリープを含む単調時計・zone・restricted/excluded/unknown・controlled transition/checkpoint・適用の有効範囲だけを持つ。DarwinではAppleが`mach_continuous_time`と同等としている`clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)`、Linuxでは`CLOCK_BOOTTIME`を使う。[Apple公式資料](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time)。awake-onlyの`systemUptime`を区間計測へ使わず、画面ロック中をgapにしない。理由、目標、native token、実アプリ名を追加しない。
3. `restricted`はenabled、適用成功/own-store確認、policyとzoneの一致、対象あり、有効範囲内、一時解除なしを必要とする。予定保存だけでは開始しない。Applying/停止の耐久commitで直前の区間を切り、再制限の成功まで開始しない。

   既存`ApplicationObservation.validUntil`には30分の評価探索上限も含まれ、OSがstoreを解除する時刻を意味しない。区間記録の上限には同じRuleEvaluatorで求めた次の実際のpolicy境界を使う。これは未確認の境界以後を切るための上限であり、境界まで成功したことの根拠にはしない。
4. 一部対象だけの解除でも累計全体から除く。解除は期限ではなく結果から追跡するため、早期終了・遅れた再制限・重なる複数grantも同じ規則で扱う。処理中や失敗の区間は補わない。
5. sample間のwall差とuptime差が2秒を超えてずれる、uptimeが逆行する、zoneが変わる、sequenceが欠ける、checkpointが不明になる場合はその区間をgapにする。OS全体の継続を証明するための仕組みではなく、観測した不連続から誤計上を防ぐためのもの。
6. 明示refresh/前景復帰で、現在の認可・own-store対象・store.isActive（対応OS）を確認する。shared snapshot sequenceを照合してcheckpointを保存する。画面の15秒pollでは新しい記録やOS writeを生成しない。Shield、monitor、grantの変更は行わない。
7. private readは100件ずつstreamして同じnative計算器へ渡す。閉じた区間だけを返し、最後の確認より現在へ外挿しない。全体累計と週/月は同token/as-of。connection内のprojection cacheはledger revision、SQLite data_version、future factの有無で検証し、削除・別connectionの変更・古いtokenを越えて再使用しない。
8. 理由/操作だけの削除は時間を残す。全記録削除は既存のsource cutoffを使い、古いbatch/cacheから復活させない。容量・payload失敗は既存のloss markerを維持し、安全な停止/再制限を妨げない。

## 限界と代替

- 観測の間に起きて元へ戻った認可・store・時計/zone変化、記録されなかったOS不具合、外部の実効設定をすべて検知できるとは保証しない。端末電源offを含む起動期間の不連続は保守的に除外する。
- 2秒の時計差の許容は時計の分解能・微小な補正に対する提案値。誤差耐性/電池/実機挙動は検証する。記録が欠けた区間を設定時間へ置換しない。
- 旧来の「—」を維持して継続遮断の別の観測方法を待つ案は、ADR0007の実遮断metricを厳密に保つ代替である。新scopeの採用前はこちらがmainの契約。
- DeviceActivityの使用時間0を遮断成功へ反転する案は採らない。新entitlement・外部送信・常駐poll・監視目的の利用追跡は追加しない。

## UIと検証

本人のタスクは、時間を設定することではなく、解除を除いた記録を穏やかに振り返ること。上部固定累計と下部週/月を維持する。見出しは「制限の適用を記録した時間」、下部で確認時刻と測定scopeを説明する。不明は0へ補間せず、partialは既知部分だけを表示する。推移では欠損を線でつながず、数値がある部分を点で示す。

DESIGN原則1/3/4/5、UI22〜25、RF01〜11。合成native/Core/SQLite/provider/UI検証と、署名済み実機でのShield確認を分ける。[実機確認手順](../qa/native-restriction-duration.md)を参照。nativeの変更を含む新しいbuildが必要。

### 終了境界の記録修正（#219）

成功したown-store確認がルール終了後に届いた場合、現在targetsとの不一致だけで直前の有効区間を失敗gapへ落とさない。同じpolicy/zoneの当時のRuleEvaluatorを使い、当時の適用成功が境界より前だったことと、解除の未解決状態がないことを確認して、既存のcontrolledTransitionで前のsampleのvalidUntilまでを閉じる。確認が失敗した場合・認可不明・時計/sequence不連続の除外は維持する。古いunknown記録の上書きや、設定時間からの加算は行わない。

本人の「10分ルールで1分未満」について、実機記録は別のauthorizationRequiredも含んでおり、この限定修正だけで解消したとは扱わない。[調査・回帰記録](../qa/restriction-duration-boundary.md)と[#222](https://github.com/kzk-maeda/itoma/issues/222)へ引き継ぐ。本追記は測定scopeの変更やADRのAccepted化ではない。
