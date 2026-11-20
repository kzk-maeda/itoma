# 可視化4案のWeb検証

2026-11-21 JST。UIソース: `ed2d2dcd24c770ffc1ec5549fb24e28ae6656ecd`。
`demo/app` tree: `145a867daa730fde32933b7b1f5b41f96de61d53`。
このソースと一致する作業ツリーからExpo静的書き出しを作成し、Chromium 155で確認した。後続の証跡コミットはUIコードを変更しない。CIは最終headを再ビルドして専用デモへデプロイする。

- [4案の操作結果](results.json): 390px Light/Dark、320px Light/Dark（DarkはDOM文字2倍）、Reduce Motion、各案×6データ。横はみ出し/JS例外なし。
- [累積線の回帰結果](baseline-results.json): 同じ4条件、5データ、線の欠測分断/既知0、期間選択で全体累計が不変、閲覧位置保持、タブ往復、キーボード。
- ブロックの端数、週の展開、月/週切替、44px以上の日付操作、選択日を保持した時間帯との往復を確認。
- モデル8テスト、ルート34 suites/338 tests、デモ基盤32テスト、ルート/独立デモのTypeScript、Lintは合格。
- expo-doctorは18/20。Expo APIのDNS失敗（exp.host EAI_AGAIN）とReact Native Directory応答エラーの2項目は環境外部接続で未完了。依存更新は行っていない。

画像名は表示条件と案に対応する。各画面は縦スクロールし、タブは固定。`calendar-detail.png` は選択日の詳細、`day-detail.png` は時間帯と区間一覧。上部/下部は1枚に無理に縮小していない。

## スクリーンショット

| 案 | Light 390 | Dark 390 | Light 320 | Dark 320 文字2倍 |
| --- | --- | --- | --- | --- |
| ブロック | [画像](light-390-blocks.png) | [画像](dark-390-blocks.png) | [画像](light-320-blocks.png) | [画像](large-dark-320-blocks.png) |
| 週の積み上げ | [画像](light-390-weeks.png) | [画像](dark-390-weeks.png) | [画像](light-320-weeks.png) | [画像](large-dark-320-weeks.png) |
| カレンダー | [画像](light-390-calendar.png) | [画像](dark-390-calendar.png) | [画像](light-320-calendar.png) | [画像](large-dark-320-calendar.png) |
| 時間帯 | [画像](light-390-day.png) | [画像](dark-390-day.png) | [画像](light-320-day.png) | [画像](large-dark-320-day.png) |

全て架空データ。時間帯の10分解除・開始終了時刻も合成値であり、OS記録の復元ではない。
DOM文字拡大はiOS Dynamic Typeではない。iPhone/Simulator/VoiceOver/実際の制限や実データは未検証。Cloudflare Access付き公開URLの認証済み実ブラウザ確認も未実施で、配信確認はActionsのデプロイ結果とローカル静的書き出しを分けて記録する。
