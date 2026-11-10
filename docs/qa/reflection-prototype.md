# 振り返り基盤・表示部品PoCの検証

対象 #136 / PR #137。[実装範囲](../system/reflection-prototype.md)。通常route/bridge/OS producerへ未接続で、PR134の詳細契約を採用する変更ではない。署名・配布・公開は行わない。

## 検証層

| 層 | 結果と限界 |
| --- | --- |
| Swift Linux | Core74 / Storage106 / Control85、計265件PASS。新規は算術11、ledger8。115/118/113分、未来/gap、月端/DST、token、点観測非計上、冪等/容量/削除cutoff/破損/再openを確認。実iOS File Protectionではない |
| React / transport | Jest99件・12suites PASS。新規12件はSwift生成25DTO、入力上限/点観測拒否、固定累計/期間選択/月→週→日、更新時のtoken解放、sync失敗、旧source遅延応答を確認 |
| 既存チェック | 型チェック/Lint、demo20、iOS tools18、expo-doctor20/20 PASS |
| iOS Native QA | 最終headのrun/build/原本digestはPRに記録。新Swiftを含むCore/Historyのコンパイルと、既存PoC→History→Home smokeを確認する。未接続のpreviewをnative上で操作した証拠にはしない |
| Web画像 | 下記の合成DTOをRN Webで描画。横overflow0、page/console error0、button最小52px。全8条件を確認 |
| 未検証 | 実container/保護/producer/outbox接続、実遮断の計上根拠、製品route、iOS Dynamic Type/VoiceOver/gesture/長時間・最大容量 |

Coreの初回fixtureテストの数値型推論、JSONEncoderのslash escapeを使った破損fixture、React Compilerのrender内可変mapを修正後、上記を再実行。実装レビューで見つかったcutoffより新しいpayload欠落の誤認と、古いtokenによる永久再試行も修正し、回帰テストで確認した。途中の失敗を成功へ転用しない。

## 画像と出所

表示source: `3e4348305953de0fd0598479491a3924a7efe6d0`（local ee55ad6、tree de3f291c40676ff2e7f0307e4d36ca043644c600）。全tracked314ファイルを展開し、原本との実byte一致を確認。temporary `src/app/reflection-proof.tsx`だけを追加。snapshotはSwift CLIの`--ui`が返す25DTOで、すべて合成または点観測として明記される。後続の証跡commitは製品sourceを変更しない。

| 画像 | 条件 |
| --- | --- |
| [week-light](reflection-prototype/week-light.png) | 390px、固定累計/週の解除除外115分 |
| [month-dark](reflection-prototype/month-dark.png) | 390px、固定累計と選択月の分離/月端の週clip |
| [partial-narrow](reflection-prototype/partial-narrow.png) | 320px、既知の部分だけと欠損表示 |
| [observed-dark](reflection-prototype/observed-dark.png) | 点の観測から0/正値を生成しない |
| [deleted-light](reflection-prototype/deleted-light.png) | 削除後に成果を表示しない |
| [not-recorded-dark](reflection-prototype/not-recorded-dark.png) | 320px、未記録を0へしない |
| [zero-light](reflection-prototype/zero-light.png) | 320px、合成fixtureの既知0は0分 |
| [month-large-dark](reflection-prototype/month-large-dark.png) | 320px、DOM文字/行高1.5倍。iOS Dynamic Typeではない |

画像は全内容が読めるよう撮影時だけscroll祖先の高さ/clipを外したfull-scroll exportで、固定viewportのnative画像ではない。UTC/as-of2026-11-10T00:00:00Zを固定。Reduce Motion指定、常時animationなし。PNG/JSbundle digest、寸法、overflow、error、button実測は[manifest](reflection-prototype/manifest.json)、source実byte比較は[source verification](reflection-prototype/source-verification.json)。

再現用[fixture route](reflection-prototype/fixture-route.tsx.txt)と[capture](reflection-prototype/capture.mjs.txt)はtxtで保存し、通常製品routeへ追加しない。検証用コピーでSDK58の`expo export --clear --max-workers 2 --platform web`を使い、localhost配信後にcaptureする。Metroの別コピーcacheが混ざらないようclearを指定する。

Swift fixtureの原本SHA256は`e9cf81ff325c2a98617715d3f4e7244492947c5c773621f46b99cf612330371a`。CLI再生成とtests/fixtures/reflection-prototype.jsonの実byte一致を確認済み。数値をJSへ写経して計算したfixtureではない。

DESIGN原則1/3/4/5、U05/U07/U08、UI22〜26/30/35/36に対応する部品検証。PR134のRF案の合成検証であり、本人の実時間の記録・製品受入・全詳細採用が完了したという意味ではない。
