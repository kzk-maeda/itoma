# 時間外もサークルを残すホーム比較デモ

本人依頼: 2026-11-20 JST / #245。画面PRは `demo/home-off-hours-circle` → `ci/isolated-demo-entry`。配信入口だけの基盤PR #247 を先にレビューする。本体の画面・状態管理・設定を試作のために変更しない。

## 画面設計

- 本人指定を優先し、時間外でもサークルを残す。直径240、円弧の線幅1.6、`1 9`の点線、muted色の55%。回転・点滅・次の開始までの進捗は加えない。
- 中央は時間帯に依存しない葉の線画と、小さな「制限時間外」の1行だけ。説明の重複を外し、余白を主役にする。色や線画だけで意味を伝えない。点線は補助的な装飾であり、その低いコントラストに情報を依存しない。
- 情報順はブランド→現在の状態→次のルール1つ。次のルールには日時・対象アプリ・本人の目標。今日の一覧、成果、キャラクター、未合意の手動開始は置かない。
- 今日・明日・来週の次の予定を表示。これは日付解決ロジックの複製ではなく、native側が次区間を確定した後の表示を想定する固定fixture。翌日以降を出せない現デモの欠落を比較する。
- 予定なしでもサークルを残し、ルールを確認する入口を置く。目標未登録時は引用面を省く。
- 320px以下でも円は224で残す（通常240）。native文字倍率1.5超ではラベルを円外へ出す。重要情報を円内へ詰めない。
- 制限中との比較は本体のPeriodRingをそのまま使い、残り1時間30分・23時終了の実線リングを表示する。解除操作の比較は#231の既存デモで扱い、このデモには実行ボタンを偽装しない。
- 設定・振り返りタブは戻れる範囲確認用の説明画面。このデモはそれらの製品UIの代替ではなく、保存・編集・集計を行わない。

DESIGN原則1/3/4、U01/U05/U07/U08、UI02/UI03/UI22/UI23/UI24/UI25に関連。今回の時間外サークルは本人の追加指定。既存の時間リングと固定のブランドロゴの責務は維持する。

## 本体との境界

`demo/app`はWebのみの独立Expoプロジェクト。Router、fixture、状態、ツールバーはデモが所有する。本体のBody/Heading/Button/useFlowTheme、OpenCircle、RuleGoal、PeriodRing/presentPeriod、ProductNavigationを一方向にimportする。本体からデモを参照させず、モジュールの差し替え、Alert・時計のグローバル上書き、native clientの呼出しを行わない。

root package-lockにある依存を親ディレクトリから解決するため、demo/app内でnpm installを実行しない。本体のsrc/、assets/、app config、modules/packages/extensionsには差分なし。基盤のscripts/docs変更は#247へ分離。この規約はCIによる全境界強制の実装完了を意味しない。

## ビルドと確認

```bash
npm run demo:package
npx tsc --noEmit -p demo/app/tsconfig.json
python3 -m http.server 8788 --bind 127.0.0.1 --directory dist/demo
# 別ターミナル（Playwrightは一時ディレクトリへ固定版で導入）
PLAYWRIGHT_MODULE=/tmp/itoma-offhours-browser/node_modules/playwright node demo/qa/check-home.mjs
```

実際のbranch/SHA/URLは `npm run demo:info` と配信先 `demo-build.json`、PRを参照。画面上部の「切替」から6条件を確認できる。時刻・アプリ・目標は架空。実OS制限、保存、課金はない。

## 検証境界

Linux ChromiumのLight/Dark、390/320px、Reduce Motion、DOM文字2倍、6条件、キーボードとタブ帰還を確認する。画像・結果は[evidence](evidence/)へ置く。DOM文字拡大はnative Dynamic Typeを証明せず、VoiceOver、iPhone、Screen Time、Extension、DSTの日付評価は未検証。静止リングなのでReduce Motionで失われる情報や操作待ちはない。

rootと独立プロジェクトの型/lint、Jest、demo tests、静的exportを確認する。Expo Doctorは18/20で、外部API（exp.hostとReact Native Directory）の接続に失敗。SDK58の公式資料取得も環境403のため、インストール済みCLI/型とビルドで照合した。配信は既存Cloudflare Accessを維持したdemoブランチ専用URL。
