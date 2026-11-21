# 振り返りの累計図の検証

実装の検証対象は `94edafa1e47c7ca8020ebb71ab29d5330d8d5daf`。Issue #266 の受入条件に沿い、PR #265 の `41f823ad97f64c4d13903ad8c57bab5095d76f85` を外観と操作の参照にした。[実装仕様](https://github.com/kzk-maeda/itoma/issues/266) · [デモの画像](https://github.com/kzk-maeda/itoma/tree/41f823ad97f64c4d13903ad8c57bab5095d76f85/demo/evidence/time-landscape)

## 通常の振り返りタブ

Linux の Chromium 155、Node 24.22.1、Expo 開発サーバーで確認した。ホームから通常の振り返りタブを開き、製品の画面と Provider に合成レスポンスを渡した。画像の幅と文字拡大率はブラウザ上の値。4条件とも動きを減らす設定を使用した。[操作結果](results.json)

| 条件 | 確認したこと | 画像 |
| --- | --- | --- |
| Light、390px、30時間 | 「1日分と6時間」、横になぞって過去日を保持、縦スクロール、最新に戻る、集計の説明、週・月の独立した切替 | [最新](light.png) · [過去日](light-history.png) |
| Dark、390px | 文字と図、前日操作の44px以上の領域 | [最新](dark.png) |
| Dark、320px、文字175% | 横方向に画面がはみ出さず、前日操作の高さ44pxを維持 | [最新](large.png) |
| Light、390px、7,384日・累計438日 | 「約1年分と73日」、過去日を横になぞって保持、最新に戻る、週・月切替 | [最新](long.png) · [過去日](long-history.png) |

長期ケースで最初に開いた週は初回レスポンスを使用し、週詳細の追加読取は0件。横操作中に9回、月次へ切り替えた後に最新へ戻す操作で1回、週を取得した。開発サーバーでのページ移動から初回表示までは8.4〜10.8秒。合成レスポンスの細かい時間と転送量はブラウザの結果を参照。[操作結果](results.json)

## 集計と読み出し

SQLite に7,384日分の期間を生成し、Swift 6.2.3、Linux Docker で同じ集計関数とストアを計測した。初回は最大64点、選択週は最大7日で、同じ token で集計する。選択週の中で日付を移動すると追加読取なし、複数週への要求が重なると最後の選択だけを反映することはJestで確認した。

| 7,384日ケース | Swift、単独実行 |
| --- | ---: |
| 初回集計と最新週 | 106.65ms、JSON 6,404バイト |
| 初回の別週読取 | 0.36ms、JSON 904バイト |
| 同じ token で100回の週読取 | 合計24.87ms |
| テストプロセス全体のピーク常駐メモリ（Linux VmHWM） | 38,724kB |

テスト全体の並行実行時は初回集計423.28ms、別週の初回読取0.78ms。これらは端末上の描画やiOSの通信を含まない。期間全体の記録が不完全で欠測の位置を特定できない場合は図の点を結ばず、選択日には読み出せた範囲でその日・累計の値と欠測を表示する。

- Jest 359件、Swift Core 85件、Swift Storage 182件、デモ32件が成功。型チェック、lint、Expo Doctor 20項目も成功。
- Web・iOSの通常JSバンドルを生成し、ソースマップで本体の累計図が含まれることを確認。合成レスポンスや計測コードを指すモジュール・識別子は、通常バンドルとソースマップのいずれからも検出されなかった。
- iOS JSバンドル SHA-256 `ed2c829a9a80555c85e6bc46dc4bfb3e45d584c836508813c4c2fd455fc2959b`
- Webの振り返りチャンク SHA-256 `e3ba45df803fd75e70b90fa3b31cfbc0e85838b8d3fa96bc4313c7dc035908ee`

## iOSでの確認範囲

この記録の撮影はブラウザで実施。iOS Simulator のビルド・起動結果は実装PRのチェックを参照。実機でのログ取込・Screen Time API、タッチとスクロールの競合、VoiceOver、Dynamic Type、Reduce Motion、メモリは未計測。

## ブラウザ確認の再現

クリーンな作業ツリーで依存を導入する。Chromium のパスは `ITOMA_QA_CHROMIUM`、Playwright のモジュールは `PLAYWRIGHT_MODULE` で指定できる。パッチは検証用のエントリーポイントにのみ適用する。

```bash
git apply --unidiff-zero docs/qa/reflection-landscape/web-harness.patch
EXPO_ROUTER_APP_ROOT="$PWD/src/app" CI=1 node --stack-size=4096 node_modules/.bin/expo start --web --port 8087
```

別のターミナルで実行し、確認後にサーバーを停止してパッチを戻す。

```bash
node docs/qa/reflection-landscape/check-browser.cjs
git apply --unidiff-zero -R docs/qa/reflection-landscape/web-harness.patch
```
