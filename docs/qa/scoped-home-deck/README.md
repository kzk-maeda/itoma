# #233 本体ルールカードとルール別一時解除

2026-11-20 JST（UTC 2026-11-19）。本体のUI接続を対象とする。固定参照デモはPR #231 / `490f675bc450d7c07ed9c5f60fdfaa5d1a373c3e`。総数見出しと専用余白は本人決定に従って削除し、日内一覧・共通解除入口も置かない。

## ソースと検証層

- 画像/操作の実装ソースは `a27a41cc00fa782fbc675811018393a8df44254a`。[browser-results.json](browser-results.json) に表示に関わる8ファイルのSHA-256を記録。
- その後mainのアイコン/CI/文書更新（#235/#241、`eed6973`）を `90fedb26045fc6cceeb549987eeb44e78173bfa5` へ取り込み、型/Lint/Jest313/demo32/Doctor20を再実行。表示8ファイルは画像時と完全一致し、統合後の通常bundle検査でも同じhashを照合した。
- Chromium 155のWebで、本体のProductHome/Unlock/Confirmation、ScreenTimeProvider、Expo Routerの実Stack、WorkFlowBoundary、typed navigationを使用。
- 一時的な [web-harness.patch](web-harness.patch) でテスト用native client/Appleラベル代替とAlert callback観測を接続した。架空のDTO・アプリ名・理由のみを使用。通常のアプリへの注入・署名・配布・公開は行っていない。
- 時刻は合成DTOの2026-11-19 21:30/22:05 UTC、ブラウザ表示もUTC。これは曜日・OSスケジュール動作の検証ではない。
- 通常のソースにはパッチを適用しない。`src/app/_layout.tsx` と `Applications` は本来のProvider/native viewのままであり、テスト用fixtureは製品から参照しない。

## 結果

| 層 | 結果・実行条件 |
| --- | --- |
| SDK互換性 | `EXPO_OFFLINE=1 CI=1 npx expo install --check` 合格（mainのquality CIと同じlock済みSDK表による確認） |
| 型・Lint | `npx tsc --noEmit` / `npm run lint` 合格 |
| Jest | 32 suites / 313 tests。native winners・鮮度・期間/selection境界、カードidentity/中断/100往復、冷起動scope、実Provider+root dirty guard、取消失敗、受付失敗/応答snapshotなし、遅延preview/受付/古い破棄ダイアログを含む |
| demo tooling | `npm run test:demo` 32/32。デモ公開は行わない |
| Expo | `NODE_USE_ENV_PROXY=1 npx expo-doctor` 20/20。最初の直接接続ではExpo API/Directoryのネットワーク確認2件が失敗し、環境の既存proxyを使って再実行 |
| Web画像・操作 | Light/Dark各320×568・375×667・390×844の6条件＋長い日本語/DOM文字2倍の320/375の2条件。横溢れなし、主ボタン44px以上、スワイプと前後ボタン、非表示本文なし、commandなしの閲覧、ルール別候補。ページエラー/警告0 |
| Web一連操作 | 読書→入力中22:05→候補0/理由と7分を保持→ホームでおやすみ前を明示選択→Xだけ受付→候補TikTokのみ。受理後/明示破棄後のroot退出に二重ダイアログなし |
| 通常Webビルド | `expo export --platform web --source-maps --clear` 合格。31 JS/31 mapを調べ、表示の8ファイルがcommitと一致し、QA fixture/架空client/時計の混入なし。[bundle検査](production-bundle-check.json) |
| Reduce Motion | Webの6条件中5条件をreduceで確認し、ドラッグ中もtransformなし。通常条件では移動/回転を観測。Jestで静止切替・途中の取消/カード消失を確認 |

HD01〜08と原則1/2/3/4、U02〜U06、P02/P03、UI01〜04/UI09/UI14/UI18/UI20/UI22〜25に対応。unit/component/Webの結果をiOSやOS制限の合格に読み替えない。

## 画像

| 条件 | 画像 |
| --- | --- |
| 通常Light | [320](light-320-home.png) / [SE相当375](light-375-home.png) / [390](light-390-home.png) |
| 通常Dark | [320](dark-320-home.png) / [375](dark-375-home.png) / [390](dark-390-home.png) / [読書](reading-dark.png) |
| 操作/入力 | [ドラッグ途中](drag-left.png) / [読書の解除候補](scoped-unlock.png) / [ルール終了後の入力保持](ended-rule.png) / [確認](confirmation.png) / [反映未確認](unconfirmed.png) |
| 長い名前・目標/文字2倍 | [320ホーム](large-long-320-home.png) / [320入力](large-long-320-input.png) / [375ホーム](large-long-375-home.png) / [375入力](large-long-375-input.png) |

狭幅/大きな文字では縦スクロールでカード・入力・確認へ到達する。DOM文字拡大はレイアウトの補助確認であり、iOS Dynamic TypeやOSキーボードの代用ではない。

## 再現

依存導入済みの専用checkoutとChromium/Playwrightがある環境で、先に通常変更を保存する。パッチはQA用で、製品ビルド/commitへ適用状態を残さない。

```bash
git apply --unidiff-zero docs/qa/scoped-home-deck/web-harness.patch
EXPO_NO_TELEMETRY=1 EXPO_ROUTER_APP_ROOT="$PWD/src/app" CI=1 npx expo start --web --clear --port 8086
# 別のterminalで。PLAYWRIGHT_MODULE / ITOMA_QA_CHROMIUMは必要なら指定。
node docs/qa/scoped-home-deck/check-browser.cjs
# 検証serverを停止してから元へ戻す。
git apply --unidiff-zero -R docs/qa/scoped-home-deck/web-harness.patch
git diff -- src/app/_layout.tsx src/components/flow/applications.tsx
```

[fixture](../../../tests/fixtures/scoped-home-web-qa.tsx) はこの一時パッチからのみ参照する。Jestのテスト入力は [scoped-rules.ts](../../../tests/fixtures/scoped-rules.ts)、操作は [scoped-unlock.test.tsx](../../../tests/scoped-unlock.test.tsx)、カードは [rule-deck.test.tsx](../../../tests/rule-deck.test.tsx)。

通常ビルドの検査（パッチを戻したcheckoutで実行、公開なし）:

```bash
ITOMA_DEMO_BUILD=0 EXPO_ROUTER_APP_ROOT="$PWD/src/app" npx expo export --platform web --source-maps --clear --output-dir /tmp/itoma233-product-export
node docs/qa/scoped-home-deck/check-production.cjs /tmp/itoma233-product-export
```

## iOSで残る確認

Simulatorの署名不要ビルド/smokeは実行時のPR Actionsへ記録する。本資料のWeb画像はSimulator画像ではない。

- iPhoneの実カードスワイプ、縦スクロール/カード内ボタン/OS左端戻りとの競合、切替の体感。
- VoiceOverの順序・非表示カード除外・選択通知・戻った際のフォーカス。
- SE第3世代のDynamic Type、長い文章、ソフトウェアキーボード、Reduce Motionの途中変更。
- native snapshot/解除受付/Extension・Screen Timeの実効動作。UI側で勝者や期限を再評価していない。

#56のホーム全体/OSゲートと#131/#135等の実機受入は引き続き別管理。UIタスクのPRマージだけでこれらを完了にしない。
