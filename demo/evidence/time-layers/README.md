# 時間の層と束：Web検証

2026-11-21 JST / #262。
UIソース `d6a8dc4784a2b6255d8eba2bd46426134135f959`、demo/app tree `28105af9e04f833268e0d9fca4c2a279c75f2a13`。
同じUIソースのコミット前作業ツリーからExpo静的exportし、Linux Chromium155で操作した。後続コミットは証跡のみでUIコードは同じ。最終headは別途packageしCIでも再ビルドする。

## 検証結果

- [操作結果](results.json)：390/320px、Light/Dark、DOM文字拡大、Reduce Motion。追加で実際に1層増える、取消で元の枚数/秒数へ戻る、日/月/年で束になる、端数も残ることを確認。
- 部分欠測/0/未記録、未記録からの追加不可、既知0からの開始、連続操作、場面の取消、タブ帰還、Space操作、期間選択の独立を確認。pageerror/横overflowなし。
- [アニメーション途中の離脱](animation-exit.json)：Webで追加から約10ms・scaleY=0.999059の時点で離脱。非表示中のtransformが変わらず、復帰では最新の1日分＋50分を表示。
- [大きな主要数値の表示](large-text.json)：62px→124px、単位/端数もDOMで2倍指定。数値・単位・端数の全体が、スクロール領域内に同時に収まることを測定。操作欄は280px以内でスクロール可能。
- DOM拡大ケースは、各操作後の表示へ2倍指定するWeb上の検証。OSの文字サイズ設定による継続的な拡大とは異なり、実機のDynamic Type合格とはしない。
- [元の成長体験の回帰](growth-regression.json)：look=originalで4表示条件、4段階/3境目、欠測/0/週月の独立/キーボード/帰還/旧5ルートが合格。
- モデル16 tests（今回4追加）：全層と束の秒数合計、端数、境界±1秒、360日≠365日、描画範囲、追加/取消、未記録の保存が合格。
- ルート/独立デモTypeScript、Lint: PASS。Jest34 suites/338 tests、demo基盤32: PASS。
- expo-doctor18/20。exp.host DNS EAI_AGAINとReact Native Directory外部取得失敗の2項目は未完了。依存は変更しない。
- 静的export10ルート。今回の変更はdemo/のみで本体/サイト/CI変更なし。

## 画像

| 場面 | Light390 | Dark390 | Light320 | Dark320 DOM拡大 |
| --- | --- | --- | --- | --- |
| 初期30時間 | [画像](light-390-initial.png) | [画像](dark-390-initial.png) | [画像](light-320-initial.png) | [画像](large-dark-320-initial.png) |
| 1日分の直前 | [画像](light-390-日分-before.png) | [画像](dark-390-日分-before.png) | [画像](light-320-日分-before.png) | [画像](large-dark-320-日分-before.png) |
| 1日分へ束ねた後 | [画像](light-390-日分-after.png) | [画像](dark-390-日分-after.png) | [画像](light-320-日分-after.png) | [画像](large-dark-320-日分-after.png) |
| 月の直前 | [画像](light-390-か月分-before.png) | [画像](dark-390-か月分-before.png) | [画像](light-320-か月分-before.png) | [画像](large-dark-320-か月分-before.png) |
| 月へ束ねた後 | [画像](light-390-か月分-after.png) | [画像](dark-390-か月分-after.png) | [画像](light-320-か月分-after.png) | [画像](large-dark-320-か月分-after.png) |
| 年の直前 | [画像](light-390-年分-before.png) | [画像](dark-390-年分-before.png) | [画像](light-320-年分-before.png) | [画像](large-dark-320-年分-before.png) |
| 年へ束ねた後 | [画像](light-390-年分-after.png) | [画像](dark-390-年分-after.png) | [画像](light-320-年分-after.png) | [画像](large-dark-320-年分-after.png) |
| 438日分 | [画像](light-390-year-detail.png) | [画像](dark-390-year-detail.png) | [画像](light-320-year-detail.png) | [画像](large-dark-320-year-detail.png) |

[1年分の端数も束と層で残す](year-breakdown.png) / [124pxの主要数値と端数](large-readout-confirmed.png)。

月30日/年365日は目安の換算。層/束の個数は実量と対応させ、側面の厚さや面積は比例尺にしない。追加は固定確認日までの架空の日別記録を再生成するデモ操作で、実履歴の追記/保存ではない。

iPhone/Simulator/VoiceOver/実際のDynamic Type/OS制限・実記録は未検証。実際の用途や有効活用を測定していない。公開URLのログイン済み実ブラウザ観測は未実施。ローカル静的画面の検証とActionsの配信成功は区別する。
