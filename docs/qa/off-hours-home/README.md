# #250：時間外ホームの本体接続

2026-11-20 JST。本人指示で#243（#233の制限中カード）へ追加する。固定参照はPR #248 / `bf2661871584a5f23c766d20faa0c29f09a288b0`。葉/月/イラスト等の途中案、デモRouterや公開設定は製品へ移さない。

## ソースと検証層

- 製品コードは `7b129ea6c87ad35c5bb04a4f5e522321224c4777`。全体の型/Lint/Jest338/demo32はこの製品ソースで実行。`e19ed16f9f1fa003bbcfadac5585dc51d3b9321e`の追加差分はWeb QAの時計・操作検査のみ。
- [browser-results.json](browser-results.json)：本体のProductHome/Provider/Expo Router/実設定画面を使用したWeb証跡。製品表示12ファイルのhash、38表示条件、6条件の設定往復/未確認・停止・制限中の検査を記録。
- [production-bundle-check.json](production-bundle-check.json)：QAパッチ未適用の別checkoutで通常Web exportを実行。31 JS/31 mapを検査し、13製品ファイルの内容がcommitと一致。架空client/時計/fixtureが通常bundleへ混入しないことを確認。
- [regression-233.json](regression-233.json)：今回の製品ソースで従来の8条件と、読書の終了→入力保持→ルール選び直し→Xだけ解除、明示破棄のroot guard帰還を再実行。表示8ファイルのhashは上記12/13ファイルと一致。

Webでは[既存の一時パッチ](../scoped-home-deck/web-harness.patch)から[テストfixture](../../../tests/fixtures/scoped-home-web-qa.tsx)を接続し、合成native DTO・Appleラベル代替・時計・Alert callback観測を使用した。通常のroot ProviderとApplicationsはパッチを戻した状態でcommitしている。現在/未来の所属を評価する架空評価器は製品へ追加していない。

日時は合成の2026-11-20 19:00 UTC、表示zoneもUTC。大きい文字はQA用Dimensions.fontScale=2とDOM文字2倍で、nativeのレイアウト分岐と読み取りを補助確認した。iOS Dynamic Type/キーボード/VoiceOverの結果ではない。

## 結果

| 層 | 結果 |
| --- | --- |
| 新しいlockでnpm ci | PASS。main #246の対応版cf/wranglerを含む |
| SDK互換性 / TypeScript / Lint | PASS（Lint警告なし） |
| Jest | 34 suites / 338 tests PASS |
| 日付表示・DST | 13 testsをAmerica/New_Yorkでも再実行しPASS。春/秋・月/年端の暦日比較を含む |
| demo tooling | 32/32 PASS。公開なし |
| Expo Doctor | proxyを使い20/20 PASS |
| 通常Web export・source map照合 | 31 JS/31 map、13ファイル一致、fixture混入なし |
| Web表示 | Light/Dark各320×568・375×667・390×844 × 今日/明日/来週/日跨ぎ/目標なし/予定なし＝36条件、長文＋文字拡大320/Dark・375/Light＝2条件 |
| Web状態/帰還 | 各6条件でnilだが有効ルール残存/反映不明/停止は時間外へしない。予定なし→設定一覧→設定→ホームタブの往復、閲覧によるcommandなし、制限中のカード/解除入口を保持 |
| #233回帰 | 8表示条件・2一連操作PASS。制限中の[参考画像](regression-active.png) |

通常Webで既存SDKの「useNativeDriverをJSへfallback」の警告1種を観測した条件がある。全内容はJSONに残し、未知の警告/ページエラーを除外していない。これは既存StackのWeb実装に関する警告であり、点線サークルはAnimatedや反復演出を使わない。iOSの動きの合格とは分ける。

## 画像

| 条件 | 画像 |
| --- | --- |
| 今日 | [Light320](light-320-off-today.png) / [375](light-375-off-today.png) / [390](light-390-off-today.png)、[Dark320](dark-320-off-today.png) / [375](dark-375-off-today.png) / [390](dark-390-off-today.png) |
| 明日 | [Light](light-390-off-tomorrow.png) / [Dark](dark-390-off-tomorrow.png) |
| 来週 | [Light](light-390-off-week.png) / [Dark](dark-390-off-week.png) |
| 日跨ぎ終了 | [Light](light-390-off-overnight.png) / [Dark](dark-390-off-overnight.png) |
| 目標なし | [Light](light-390-off-no-goal.png) / [Dark](dark-390-off-no-goal.png) |
| 次の予定なし | [Light](light-390-off-none.png) / [Dark](dark-390-off-none.png) |
| 確認/停止 | [次回未確認](off-missing.png) / [反映不明](off-unknown.png) / [停止](off-paused.png) |
| 文字拡大/長文 | [Dark320](large-dark-320-home.png) / [日時までスクロール](large-dark-320-date.png)、[Light375](large-light-375-home.png) / [日時](large-light-375-date.png) |

## 接続と判定

- 次回の開始/終了・ruleIDはnativeの同じnextPeriodから取得し、保存されたselectionRefを既存native表示へ渡す。現在targetsから未来のアプリを選ばない。名称/目標未登録は既存fallback/引用なし。
- 次回は8日間の有限探索。nilだけで永久に予定がないとせず、有効ルールが残るnilや不一致は確認状態。全て無効の保存済みルールとfreshな正常snapshotでのみ「次の予定なし」。未設定・初回設定・不明と区別する。
- 境界後の過去のnextPeriod/残っている旧periodsは隠し、native再取得を待つ。時計だけで制限成功を作らない。
- 日付/zone/offset変更時は可視画面の既存時計から再取得する。先行する読取との合流を一度待ち、その後の新しいnative読取で確認する。失敗は確認状態を維持し、後続pollで回復する。タイマーを増やさない。
- 原則1/3/4、U01/U05/U07/U08、UI02/UI03/UI14/UI20/UI22〜25、OH01〜06。DOMとcomponentの確認を実機合格へ読み替えない。

## 再現

依存とChromium/Playwrightのある専用checkoutで、既存のQAパッチを一時適用する。製品のbuild/commitへ適用状態を残さない。

```bash
git apply --unidiff-zero docs/qa/scoped-home-deck/web-harness.patch
EXPO_ROUTER_APP_ROOT="$PWD/src/app" CI=1 npx expo start --web --clear --port 8086
# 別terminal。必要に応じPLAYWRIGHT_MODULE / ITOMA_QA_CHROMIUMを指定。
node docs/qa/off-hours-home/check-browser.cjs
ITOMA_QA_OUTPUT=/tmp/itoma250-regression233 node docs/qa/scoped-home-deck/check-browser.cjs
# server停止後
git apply --unidiff-zero -R docs/qa/scoped-home-deck/web-harness.patch
ITOMA_DEMO_BUILD=0 EXPO_ROUTER_APP_ROOT="$PWD/src/app" npx expo export --platform web --source-maps --clear --output-dir /tmp/itoma250-product-export
node docs/qa/off-hours-home/check-production.cjs /tmp/itoma250-product-export
TZ=America/New_York npx jest tests/off-hours-presentation.test.ts --runInBand
```

## Simulator・実機

旧head `35e9b7c`の[署名不要Simulator build/smoke](https://github.com/kzk-maeda/itoma/actions/runs/44560361707)は成功しているが、今回のUIを含まない。新headの結果はPR Actionsへ別記する。Swift/native DTO/設定は本変更で変えていない。

iPhone/Simulatorの実画面、VoiceOverの順序とフォーカス、最大Dynamic Type、ソフトウェアキーボード、iOS gesture/フレーム安定性、Screen Time/Extensionの実効は未検証。#56/#131/#135等の実機ゲートは別管理する。
