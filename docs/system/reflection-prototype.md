# 振り返りの独立実装PoC

> 現在: 本人がPR134を採用・マージした。#138で [製品接続](reflection-records.md) を追加し、Calendar helperと表示を再利用する。synthetic entryと独立schema1 ledgerは通常route/製品storeへ配線しない。以下はPR137作成時の限定PoCの記録。


対象 #136。本人の「進められる実装は進めて」に従い、#97〜#99から保存・計算・表示の基盤を分離する。AGENTS.mdの小さい明示的PoCの範囲。#96/[PR134](https://github.com/kzk-maeda/itoma/pull/134)の詳細採用は未完了で、ADR0007をAcceptedに変更しない。PR134のマージは人間の採用ゲートによって自動承認レビューで拒否された。本PoCはそれを迂回して製品集計を採用するものではない。

## 接続範囲

- `ReflectionPrototypeCalculator`はItomaCoreの純粋Swift。合成fixtureの区間union、解除/gapの除外、as-of、Calendarの週/月/DST、固定累計・有界DTOを計算する。新しいOS予定や解除処理は行わない。
- `ReflectionObservationLedger`はItomaHistory内の独立SQLite schema1。既存History schema3/Control schema6/Monitor schema1を変更しない。本体・Extension・bridgeから開く呼出元はない。実container、File Protection、backup除外、shared outboxとのcommit/ack、実native producerの接続は #97 に残す。
- `src/experiments/reflection/`は再利用可能なRN表示とsource interface。通常route/ホーム/本番bridgeへの接続なし。検証用sourceはtests/一時的な撮影routeだけ。合成の成果を通常画面へ表示しない。

## 計算と証拠

正値入力は`syntheticFixture`限定。`pointObservations`は正値の区間を受け付けず、knownSecondsを**0にもせずnil**で返す。二つのreadback・予定期限・policyの有効化から連続した実遮断を生成しない。UIもpoint DTOに数値があれば拒否する。全snapshotにprototypeのmetricVersion/proofScope、source/revision/as-of/zoneのtokenを付ける。

同じ合成データで115分/118分/重複解除113分、停止/編集90分、gap75分を確認する。累計は週/月/期間移動で固定。下部だけ対象期間を変え、月の週行は月端でclipする。Calendarの23/25時間の日を86400秒へ固定しない。表示時だけ丸め、計算はSwiftへ一元化する。

区間入力は合計20,000件、DTOは週7/月6bucket・trend64まで。内部計算はunionのsortと区間走査を使い、全履歴をJSへ転送しない。fixtureは観測済みの実時間を表すものではない。実遮断の正値を表示できる根拠/範囲は#96/#98/#131の残るゲート。

## 観測ledger

理由本文/token/実アプリ名/自由文を受け付けない型付きの点観測だけを保存する。event/source/sequence、時刻、kind/outcome、policy revision、不透明scopeID、zone、任意の予定期限を持つ。予定期限は観測期間の証明ではない。

明示create/open、別application ID、FULL/WAL、private候補0600、短いwriter transaction、ローカル直列化を使う。未知schema/破損は初期化しない。openはpayload/identityを100件単位で検証する。openの総量はO(n)、pageの整合確認もmetadataを走査しうる。本実装の最大容量/並行性/時間計測は別検証が必要。

同じeventID/source/sequence/payloadの再送はrevisionも増やさない。競合はrollback。sequence欠損/容量停止はincompleteをdurableに残し、後の追記で過去の欠損を自動解消しない。high-waterは**最大観測sequence**であり、連続取込済み境界/ack/実時間のconfirmedThroughではない。capacityStoppedで元outboxをackする接続は実装しない。

payload byte数と現存point件数の上限はcaller必須入力で、出荷既定値を追加しない。削除後のID tombstone/source cutoff、DB/WAL等の大きさはこの上限に含まれない。既存Historyと共有の製品容量予算は未接続であり、この値を別DBの追加製品予算に採用しない。

削除はsource cutoff以下のpayloadだけ。ID/cutoffを保持し、旧再送を復活させない。cutoffより新しいpayload欠落は削除ではなくcorruptとする。別sourceは保持。削除後の新規観測は保存できるが、過去の制限区間を復元しない。理由/履歴の既存削除ボタンへ本ledgerを暗黙に追加しない。

## 表示と検証

固定累計→週/月→期間移動→月の週→日のcallbackという部品契約。source側がnative日付/clip/tokenを返し、JSで区間集計を複製しない。明示refreshはtokenを解放して全体を更新し、changed時は累計/下部を一緒に破棄する。source変更や遅い旧応答を棄却し、読取失敗を空にしない。timer/購読を作らない。

検証表示を常設し、Graphite・44pt操作・長い時間の折返し・グラフ代替説明を使う。解除を失敗/減点にせず、自分の時間の積み重ねを穏やかに伝える。DESIGN原則1/3/4/5、U05/U07/U08、UI22〜26/30/35/36、PR134のRF01〜11案に対応する。実機Dynamic Type/VoiceOver/戻るgestureは未合格。

fixtureは次でSwiftから生成する。Tools targetはCore Podの`Sources/ItomaCore` globに含まれない。テストのJSONは集計結果をJSへ写経したものではない。

```sh
swift run --package-path packages/itoma-core --jobs 2 reflection-prototype-fixtures --ui > tests/fixtures/reflection-prototype.json
```

画像/再現方法は[QA記録](../qa/reflection-prototype.md)、Native QA/最終SHAはPRへ記録する。raw ledgerを本体/Extensionへ配線し、採用済みの根拠で正値を返すことと、本PoCの保存/算術/表示の合格を区別する。
