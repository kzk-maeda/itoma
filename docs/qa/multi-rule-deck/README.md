# ルールカードのスワイプとルール別解除（#230 / #231）

2026-11-19 JST。公開版5ccfcd0へ本人の追加依頼を反映したworking treeを、Linux Chromium 155で確認。source/画像のSHA-256を[source-sha256.json](source-sha256.json)、操作結果を[results.json](results.json)へ記録した。同じソースをコミット後、配信前のCIでも対象SHAを付けて画像/JSONを再生成する。CI run・公開SHA・Version IDはPR/Issueを参照。

| 状態 | 画像 |
| --- | --- |
| ホーム：今日の一覧を削除、カード1/2 | [home-light.png](home-light.png) |
| 実touch drag中の横移動・回転 | [drag-left.png](drag-left.png) |
| カード2/2、Dark | [reading-dark.png](reading-dark.png) |
| 読書ルールからはX/YouTubeだけ | [scoped-unlock.png](scoped-unlock.png) |
| ルール終了時は候補0、理由は保持 | [ended-rule.png](ended-rule.png) |

4条件（390 Light/通常モーション、320 Light/Reduce Motion、390 Dark/Reduce Motion、320 Light/文字2倍/Reduce Motion）で左右の実touch drag・前後ボタン・各ルール内の解除入口を確認。通常はdragに追従する移動/回転、Reduce Motionはtransformなし。横overflowなし、44px以上の操作、pageerror 0。文字拡大はDOMへ模擬適用しており、native Dynamic Typeではない。

解除候補は夜→Instagram、読書→X/YouTube。22時へ切り替えると読書の候補は0になり、別ルールへ自動で広がらない。ホームでおやすみ前を明示的に選び直すと、理由を保持してX/TikTokへ切替。Xの模擬解除後は同ルールの候補がTikTokだけになる。破棄確認後のホーム復帰、時間外/不明/停止、単独/日跨ぎもPASS。

再現：`ITOMA_DEMO_BUILD=1 ITOMA_DEMO_BASE_PATH='' node node_modules/expo/bin/cli export --platform web --output-dir /tmp/itoma-swipe-export --max-workers 2 --clear` 後、`ITOMA_QA_EXPORT=/tmp/itoma-swipe-export ITOMA_QA_CHROMIUM=/usr/bin/chromium node scripts/check-multi-rule-demo.cjs`。通常のdemo:package結果は同じscriptを追加変数なしでCIの既存Chromeから検証する。Playwrightは検証環境のものを使用し、製品dependenciesには追加していない。

型/lint・Jest30 suites/292 tests・demo tooling32 testsをPASS。ローカルexpo-doctorは18/20で、Expo/React Native Directoryの外部取得2件が失敗。Simulator/実機・VoiceOver・native gesture/実際のDynamic Type・Screen Time/Extension/永続化は未検証。画像は架空の設定・アプリ・目的であり、実際のOS制限を示さない。
