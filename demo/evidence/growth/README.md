# 時間がまとまるサークル：Web検証

2026-11-21 JST / #258。

UIソースは `24eaf756550a017c730d2981ddb007ad929bf284`、`demo/app` treeは `c08eb22fb9dd5ace90c06a54561a6b7d86ea815b`。同じUIソースの作業ツリーをExpo静的exportし、Linux Chromium155で検証した。後続のコミットは画像・結果のみで、UIコードは同じ。

## 検証したこと

- [操作結果](results.json)：390px Light/Dark、320px Light、320px Dark＋DOM文字2倍。4段階と3境目、部分欠測/未記録/既知0、週/月内訳の独立、キーボード、ホーム/設定の帰還を確認。pageerror・横overflowなし。
- [旧累積線の回帰結果](baseline-results.json)：同じ4条件で5データ、欠測分断/既知0/累計不変/閲覧位置/往復を確認。新しいreflection画面を経由しても旧fixtureは維持。
- 時間/日/月/年は同じ集計値を閾値で切り替え、秒を切り上げない。24時間・30日・365日の±1秒、端数保存、概算表示、fixture合計・日順、節目は4つのモデルテストで検証。従来モデル8件も合格（合計12）。
- ルート/独立デモのTypeScript、Lint合格。Jest34 suites/338 tests、demo基盤32 tests合格。
- expo-doctorは18/20。exp.host DNS（EAI_AGAIN）とReact Native Directory外部取得の2項目は未完了で、依存を変更していない。
- 10ルートの静的export。最終headを別途packageし、CIでも同じheadを再ビルドして専用Workerに配信する。

## 画像

| 段階 | Light390 | Dark390 | Light320 | Dark320 文字2倍 |
| --- | --- | --- | --- | --- |
| 時間 | [画像](light-390-hours.png) | [画像](dark-390-hours.png) | [画像](light-320-hours.png) | [画像](large-dark-320-hours.png) |
| 日 | [画像](light-390-days.png) | [画像](dark-390-days.png) | [画像](light-320-days.png) | [画像](large-dark-320-days.png) |
| 月 | [画像](light-390-months.png) | [画像](dark-390-months.png) | [画像](light-320-months.png) | [画像](large-dark-320-months.png) |
| 年 | [画像](light-390-years.png) | [画像](dark-390-years.png) | [画像](light-320-years.png) | [画像](large-dark-320-years.png) |

[文字2倍・数値を円の下へ移した部分](large-readout.png) / [節目と期間内訳](year-milestones.png) / [未記録](light-390-empty.png) / [0分](light-390-zero.png)。文字拡大時もスクロールで数字・単位・端数に到達でき、縮小や省略で収めていない。

- [1日分の直前](light-390-日分-before.png) → [直後](light-390-日分-after.png)
- [1か月分の直前](light-390-か月分-before.png) → [直後](light-390-か月分-after.png)
- [1年分の直前](light-390-年分-before.png) → [直後](light-390-年分-after.png)

全て固定の架空データで、実際の時間の使い道や有効活用を測っていない。月30日・年365日は提案上の概算であり、12か月を機械的に1年へ変換しない。

iPhone/Simulator/VoiceOver/実際のDynamic Type/OS制限・実記録は未検証。DOM拡大は実機検証の代用ではない。公開URLの認証済みブラウザ観測は未実施。配信結果とローカル静的画面検証は区別する。
