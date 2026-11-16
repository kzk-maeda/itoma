# 終了境界の時間欠落と実機の認可不明の切り分け

対象: #219 / #222。本人報告はiPhone SE第3世代 / iOS27.0.1、main `6fad80d6c6852bebc58a45f935a7e7b4fe89c915`、native build `8833536e-6393-430b-b705-c7d3a4c05536`、JS SHA256 `a30c3eb04ca427ee9701341dfdcbfb3b0d8a7aec1dd59df6422d5b5ef9310400`。「10分ルールを試すと振り返りは1分未満」。本人の画面報告と、以下のagentによる記録調査を区別する。

## 確認できた2つの経路

1. **成功checkpointなのに終了前区間が消えるコード不具合**。最後に適用成功したtargetsがown storeと一致していても、終了時刻を過ぎると現在のRuleEvaluatorのtargetsが変わり、sampleがunknown checkpointになる。集計器はこれを失敗した確認と同じように扱い、最後の成功確認からの区間全体をgapへ落としていた。実Control/History Repositoryで「開始→20秒後の確認→600/605/900秒後の成功確認→再評価」を再現すると、累計・選択期間・bucket合計が600秒の代わりに20秒になる。修正後は600秒で、終了から遅れた再評価までの時間は加算しない。
2. **今回の実機では終了処理が認可不明**。コピーした記録DBは整合性検査を通過し、開始・終了付近のapplicationがuncertain / authorizationRequired / activation=enabledだった。終了前の短い確認済み区間だけが残り、最後の長い区間はunknown checkpointで欠けている。これは1の成功checkpointとは別であり、この限定修正だけで今回の実機記録を10分へ変えない。OSのShieldが継続していたか、実際に認可が取り消されたかはこのデータから断定しない。

生DB・実理由・native token・実目標・署名情報は掲載しない。agentはrepo内の保護したGit管理外領域でreflectionの時刻・状態だけを検査し、端末上のDBや設定を変更していない。実データをテストfixtureへ転用しない。

## 修正範囲

`ReflectionOutbox`だけを変更する。現在の成功適用、同じpolicy/zone、解除の未解決状態なし、成功観測が当時のルール境界より前であることを確認した上で、その境界に到達したsampleを既存のcontrolledTransitionとして記録する。古い評価の短い表示horizonではなく、同じRuleEvaluatorで当時の実policy境界を求める。

集計器は直前のsampleのvalidUntilまでで閉じる。開始前・終了後への外挿、失敗した認可/own-store確認、時計/zone不連続、sequence欠落、解除、未知schemaの扱いは変えない。既存の不明記録は成功へ書き換えない。旧unknown checkpointから、失敗と正常な終了を安全に区別できないためである。schema/metric/permissionの変更なし。nativeRecordedIntervalsの測定範囲・ADR0010のProposedは維持する。

## 回帰検証

`packages/itoma-storage/Tests/ItomaHistoryTests/RestrictionDurationBoundaryTests.swift`。

- 終了ちょうど・5秒後・5分後に成功確認: 20秒→600秒。累計・週・日別bucketの一致。遅延部分はpartial。
- 終了後のown-store確認失敗、途中の確認失敗、時計不連続: 不明区間を加算しない。
- 終了後に初めて観測: 過去の設定10分を埋めない。
- 認可不明のcallback: 以前に確定した54秒だけを返し、10分の成功へ変換しない。

red/greenの原本はrepo内 `.tmp/qa/restriction-duration-20261116/` に保持する。自動テストは制御・SQLite・DTOの検証であり、実際のShieldやExtensionの成功ではない。修正を含むnative buildのSHA/build ID/構成・テスト結果は対応PRに記録する。

## 実機の残件

[#222](https://github.com/kzk-maeda/itoma/issues/222)で、cold Extensionの認可取得・main queue・同期callbackの実行条件を調査する。Appleの[authorizationStatus](https://developer.apple.com/documentation/familycontrols/authorizationcenter/authorizationstatus)には初期値notDeterminedとmain queueでの参照が指定される。現在のcustom actorからの即時参照だけでは、失敗原因を特定できない。unknownをapprovedに置換する変更は本修正に含まない。

修正後の実機で、開始直後の成功確認→ロック/背景→終了後に振り返りを開く前後の順序を分け、実アプリのShield開始/解除と数値を確認する。表示は分単位切捨てで、開始の適用遅延を含めて必ず10分になるとは扱わない。#131/#135/#98をこの限定修正だけで完了にしない。
