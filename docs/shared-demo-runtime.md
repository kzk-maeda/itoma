# 本体の画面を使うデモ基盤

Issue #201。実際のExpo Routerのルート・画面・共通部品・Providerを共有し、データの接続先だけを差し替える。初版の基点はmain `f4b477d`。HTMLで再現した従来のデザインデモとは区別する。

## 構造

```text
src/app/_layout.tsx
  AppProviders
    iOS/native: ProductProviders → 既存native clients
    Web通常:   ProductProviders → 既存clients（unsupported-platform）
    Web demo:  DemoProviders → ProductProviders(clients=session.clients)
                                ├ ScreenTimeProvider
                                ├ OnboardingProvider
                                ├ HistoryProvider
                                └ ReflectionProvider
                                  同じStack・実画面・共通部品
```

- `src/runtime/product-providers.tsx`: 共通Provider階層とtyped ProductClients。未指定の接続は既存native defaultのまま。
- `src/runtime/app-providers.tsx` / `.web.tsx`: platform別の入口。同じ拡張子で揃え、Metroのplatform解決を使う。iOS側からdemoのsession/toolbarへ依存させない。
- `src/demo/session.ts`: 型付き・契約parserを通すメモリー内クライアント。画面のJSXや描画を持たない。
- `src/demo/demo-providers.tsx`: シナリオ/結果の選択、demo表示、sample label注入。画面の独自実装やルートの複製はない。
- `src/runtime/application-labels.ts`: Appleのnative保存対象Viewの代わりに、Web demoでだけfixtureの名前を供給。通常のアプリは従来のnative View/安全な件数表示。
- `src/runtime/product-alert.tsx` / `.web.tsx`: iOSでは同じRN.Alertを再export。WebではRN Webのno-op Alertに代わり、同じtitle/message/buttons/callbackをModalで表示。破棄/停止/削除を実ルートでも確認できる。一般Webもこのplatform fallbackを使う。

## 新しいデモを作る

1. 最新mainから `demo/<目的>` ブランチを作る。
2. `npm ci`、`npm run demo:web` でWeb preview。環境変数の変更後は開発サーバーを再起動する。
3. 見た目/操作の変更は `src/components/...` の本体画面・部品に加える。新規HTMLへコピーしない。将来の画面も本体と同じルートで確認する。
4. 状態やデータだけの違いは `src/demo/session.ts` に型付きシナリオ/結果として追加する。成功/失敗/未確認を分け、未サポートの操作を成功扱いしない。既存parser・本体の契約に合わせたテストを追加する。
5. 必要な外部接続が増えたら `ProductClients` の明示的なportとして注入する。画面に `if (demo)` を増やして別画面へ分岐しない。
6. 本体の既存チェック、session/Providerテスト、Webの実フロー、通常buildへの非適用を確認し、画像・SHA・未検証をPRへ記録する。
7. `demo/**` へpushして既存Deploy demoで公開する。mainにマージしただけでdemo配信される意味ではない。現状のdemo一覧は配信先のrootへ直接進める。

本体変更と一緒にレビューできるため、同じcommit内では部品とdemoの見た目が同期する。公開済みdemoはそのブランチのcommitに固定され、mainの変更で自動更新されない。最新mainを取り込んで再検証・再配信する必要がある。

## Buildと起動条件

- `npm run demo:build` / `demo:package` はWeb exportに `EXPO_PUBLIC_ITOMA_DEMO=1` とbranchのbase pathを明示。manifestに `presentation: shared-app` を記録。
- 通常の `npm run web` / 通常exportはflagなし。`?scenario=...` や `?demo=1` だけでmockを起動しない。
- iOSはplatform別の入口でdemoをimportしない。flagを誤って指定してもデモ接続にならない。native/entitlement/署名を変更していない。
- flagもシナリオも公開情報。APIキー等のsecretをEXPO_PUBLICへ入れない。
- 既存HTMLデモをすべて移行するPRではない。新しい共有UIデモは `public/demo-entry.json` によるstatic上書きを使わない。

## 初版の範囲

- シナリオ: 通常・反映未確認・停止中・許可なし。切替/リセットは確認後にdocumentを再読込し、Provider draft・共通snapshot session・private reasonを一緒に破棄する。複数タブも独立。
- 対応: 実ホーム、サンプル3アプリ、一時解除preview/確定/取消、複数アプリの個別期限、成功/予定登録失敗/未確認、元の期限での再試行、期限終了/早期終了の未確認、再確認、停止/再開、名前/目標編集、操作記録/理由/日付/40件pagination/削除。
- 未対応: ルール追加・曜日/時刻の編集/削除、対象の選び直し、初回設定の一連の流れ。typed clientはunavailableを返し、保存済みと装わない。必要なdemoで対応portのfixtureを追加する。
- 時間の累計・週次/月次は未提供。既存の準備中/記録なしの画面を使い、架空の達成時間を表示しない。
- fixtureのavailability=deviceは実画面の能力分岐を試すための合成値。bannerを常時表示し、実機・OS成功の証拠にしない。
- 時計は実際のDate.now、fixture生成時から90分の時間帯。時刻を固定する必要がある単体テストではcreateDemoSessionのnow portを注入。UIの時計を勝手に変えたり、snapshotを読むたびに期限を延長しない。

## データと限界

理由・記録・設定はタブのメモリーのみ。URL、ログ、Web Storage、外部APIへ送らない。再読込で失うため本体の永続化・kill復旧を検証できない。保存容量の数値もfixtureで、実ファイルの測定ではない。

sessionはUIの契約fixtureであり、採用済みドメイン/Swift/OSのエミュレーターではない。ルール競合、権限取消、pending処理、復旧や本物のアプリ選択は本体と実機で検証する。WebのModal、IME、keyboard、フォント/画面サイズ、SVG、スクロールはiOSと異なる。同じReact Native部品を使っていてもpixel一致や実機成立の保証ではない。

前の3論点デモ #200 は情報設計の検討用。今回のデモは「現在の実装を同じ部品で動かす」基盤であり、その改善案を自動採用したものではない。採用する改善は本体画面/部品へ別途差分として実装して比較する。

## 検証

`tests/demo-session.test.ts`: schema/期限固定/二重受理/個別対象/取消/失敗/未確認/削除/session分離/未サポート。
`tests/shared-product-providers.test.tsx`: 実ProductHome・Applicationsと共通Providerが注入clientの結果を表示し、native clientを呼ばない。
画像・ブラウザー再現script: `docs/screenshots/shared-components/`。通常Webのquery非適用、demoの本物のroutes、Web確認dialogの動作を別々に検証する。iOS JS exportはdemo module除外の確認に使えるが、native build/実機の確認には数えない。

Expo SDK58の[参照資料](https://docs.expo.dev/versions/v58.0.0/)、[環境変数](https://docs.expo.dev/guides/environment-variables/)、[Router](https://docs.expo.dev/router/basics/navigation/)を確認（2026-11-15）。

### 再現コマンド

```sh
npm run demo:package
# 上記成果物をclean URL対応の静的サーバーで公開し、capture.cjs.txtのBASEへ指定
ITOMA_DEMO_BUILD=1 ITOMA_DEMO_BASE_PATH='' EXPO_PUBLIC_ITOMA_DEMO=0 node node_modules/expo/bin/cli export --platform web --output-dir dist/shared-production-check
# 通常Webの /?scenario=normal&demo=1 でbannerとfixtureが表示されないことを確認
EXPO_PUBLIC_ITOMA_DEMO=1 node node_modules/expo/bin/cli export --platform ios --source-maps --output-dir dist/shared-ios-check
# .hbc.mapのsourcesにsrc/demo/・app-providers.web・product-alert.webがなく、native版のruntime入口があることを確認
```

静的サーバーでdeep linkを試すときは、Cloudflare Assetsと同じように `/history` を `/history.html` へ解決する必要がある。Python標準http.serverだけではそのdeep linkの直接再読込は404になる。本体のclient-side遷移と、配信側のclean URL解決を区別して確認する。

## 一時解除のアプリ選択行（本人指定の改修）

`ApplicationChoice` が本体とdemoで共通の選択行を担当する。行全体のPressable、右端のラジオ、選択中の枠・背景と文言、checked/disabled状態をまとめる。未選択でも○を見せる。説明文・余白・ラジオの付近を押しても、同じ1つの選択処理が動く。選び直しでは理由を消さず、対象と確認内容だけを更新する。

`Applications` は識別表示だけに絞り、nativeにはselectable=falseを渡す。Appleのアイコン・名前をJSへ取り出さず、ネストしたnativeボタンとの二重発火を避ける。WebはApplicationLabelsとApplicationSymbolsからサンプル名と代替グリフを供給する（公式アプリアイコンの画像ではない）。外枠とラジオは本体と同じReact Native部品。

選択不可の行にも理由を表示し、押しても選べない。Webにはaria-checked/aria-disabledを明示し、nativeには同じ値のaccessibilityStateを渡す。nativeではAppleの識別表示を含む名前の読み上げ・タップ領域・文字拡大を実機確認する必要がある。Swift/ABIに変更はないが、JSの外側Pressableへの集約を実機検証済みとは扱わない。

選択行の単体テスト、余白/端を押すWeb操作、枠/背景の変化、選び直しても理由が残ること、disabled、Dark/狭幅と既存フローを検証。記録・解除のドメイン仕様は変更しない。
