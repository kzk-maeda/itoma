# 振り返りの累計図の検証

現行の画面とJSバンドルの検証対象は `15414fbb387bb37db9f51407b4fedeee3a718d62`。初期実装はIssue #266に沿い、PR #265の外観と操作を参照した。今回の本人指定により、図の直下から選択日の日別見出しと時間、前後ボタン、「集計について」を外した。[実装仕様](https://github.com/kzk-maeda/itoma/issues/266) · [デモの画像](https://github.com/kzk-maeda/itoma/tree/41f823ad97f64c4d13903ad8c57bab5095d76f85/demo/evidence/time-landscape)

## 通常の振り返りタブ

Linux の Chromium 155、Node 24.22.1、Expo 開発サーバーで確認した。ホームから通常の振り返りタブを開き、製品の画面と Provider に合成レスポンスを渡した。画像の幅と文字拡大率はブラウザ上の値。4条件とも動きを減らす設定を使用した。[操作結果](results.json)

| 条件 | 確認したこと | 画像 |
| --- | --- | --- |
| Light、390px、30時間 | 「1日分と6時間」、横になぞって過去日を保持、縦スクロール、最新に戻る、週・月の独立した切替 | [最新](light.png) · [過去日](light-history.png) |
| Dark、390px | 図の下から週次・月次の内訳へ進む表示 | [最新](dark.png) |
| Dark、320px、文字175% | 横方向に画面がはみ出さず、図の操作領域は44×44px以上 | [最新](large.png) |
| Light、390px、7,384日・累計438日 | 「約1年分と73日」、過去日を横になぞって保持、最新に戻る、週・月切替 | [最新](long.png) · [過去日](long-history.png) |

30時間と長期ケースでは、図にフォーカスし、矢印キーで一日移動してEndで最新に戻れることを確認した。この操作で同じ週の追加読取は0件。「最新に戻す」のボタンは44×44px以上。合成レスポンスの読取回数と転送量は操作結果に記録した。[操作結果](results.json)

## #266の集計と読み出しの計測

初期実装の `94edafa1e47c7ca8020ebb71ab29d5330d8d5daf` でSQLiteに7,384日分の期間を生成し、Swift 6.2.3、Linux Dockerで集計関数とストアを計測した。初回は最大64点、選択週は最大7日で、同じtokenで集計する。選択週の中で日付を移動すると追加読取なし、複数週への要求が重なると最後の選択だけを反映することはJestで確認した。

| 7,384日ケース | Swift、単独実行 |
| --- | ---: |
| 初回集計と最新週 | 106.65ms、JSON 6,404バイト |
| 初回の別週読取 | 0.36ms、JSON 904バイト |
| 同じ token で100回の週読取 | 合計24.87ms |
| テストプロセス全体のピーク常駐メモリ（Linux VmHWM） | 38,724kB |

テスト全体の並行実行時は初回集計423.28ms、別週の初回読取0.78ms。これらは端末上の描画やiOSの通信を含まない。期間全体の記録が不完全で欠測の位置を特定できない場合は図の点を結ばず、読み出せた範囲で累計の値と欠測を表示する。

## チェックとバンドル

- 型チェック、lint、Jest 374件、デモ32件、Expo Doctor 20項目が成功。累計図の読み上げ用の値と調整アクションをJestで確認した。
- 通常のiOS向けJSバンドルを生成し、ソースマップで振り返りの累計図の変更を確認。合成レスポンスや計測コードを指す識別子は通常バンドルとソースマップから検出されなかった。
- HermesバイトコードのSHA-256は `b5a78d312c81380cb6469a961ce1d28f5d26ab20d53c20fc927f237a896a113f`。

## iOSでの確認範囲

この記録の撮影はブラウザで実施。iOS Simulator のビルド・起動結果は実装PRのチェックを参照。実機でのログ取込・Screen Time API、タッチとスクロールの競合、VoiceOver、Dynamic Type、Reduce Motion、メモリは未計測。

## ブラウザ確認の再現

クリーンな作業ツリーで依存を導入する。Chromium のパスは `ITOMA_QA_CHROMIUM`、Playwright のモジュールは `PLAYWRIGHT_MODULE` で指定できる。パッチは検証用のエントリーポイントにのみ適用する。

```bash
git apply --unidiff-zero docs/qa/reflection-landscape/web-harness.patch
EXPO_ROUTER_APP_ROOT="$PWD/src/app" CI=1 node --stack-size=4096 node_modules/.bin/expo start --clear --web --port 8087
```

別のターミナルで実行し、確認後にサーバーを停止してパッチを戻す。

```bash
node docs/qa/reflection-landscape/check-browser.cjs
git apply --unidiff-zero -R docs/qa/reflection-landscape/web-harness.patch
```
