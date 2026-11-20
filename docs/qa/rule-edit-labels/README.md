# ルール詳細の固定編集ラベル（#224）

2026-11-16、main `341004cf1e92f7dc6fe836c2174745f44820ea49` に本PRの変更を適用したソースで確認。対象は実装の `ScheduleDetailScreen` と既存の `LinkRow`。撮影対象 `src/components/flow/settings.tsx` の SHA-256 は `20d37e3c4d4215b17169c506c0f5852a0387773834e0fbff6c8d7e30ddad500a`。画像・寸法・ブラウザ情報は [verification.json](verification.json) に記録した。

## 画像と結果

| 画像 | 条件 |
| --- | --- |
| [long-name-light.png](long-name-light.png) | 幅390px、80文字の架空ルール名、Light |
| [actions-narrow.png](actions-narrow.png) | 幅320px、編集操作までスクロール |
| [actions-dark.png](actions-dark.png) | 幅390px、Dark |
| [actions-large-text.png](actions-large-text.png) | 幅320px、ブラウザで文字・行高を2倍に変更 |
| [actions-wide.png](actions-wide.png) | 幅768px |

全ケースで横方向のはみ出しなし。2つの編集操作は各1つ、44×44px以上で、スクロールして到達できる。名前・行動目標は `/rule-details`、対象アプリ・時間は `/rule` へ遷移。名前・目標のprivate情報を読めない場合、前者のみ無効になることも確認した。ブラウザのpageerrorは0件。文字拡大はDOMへの模擬適用であり、iOS Dynamic Typeの検証ではない。

## 再現方法

1. 本PRのソースから一時worktreeを作成。`src/qa/rule-label-proof.tsx` に [proof-provider.tsx.txt](proof-provider.tsx.txt)、`src/app/_layout.tsx` に [proof-layout.tsx.txt](proof-layout.tsx.txt) を配置する。
2. 今回は本体のnode_modulesを一時worktreeにリンクし、[proof-metro.cjs.txt](proof-metro.cjs.txt) を一時metro.config.jsとして使用した（パスは環境に合わせる）。
3. 一時worktreeで `CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 node node_modules/expo/bin/cli start --web --port 8831` を実行する。
4. PlaywrightとChromiumが利用可能な本PRのworktreeで `node < docs/qa/rule-edit-labels/capture.cjs.txt` を実行する。

ルートと画面は実装を参照し、native clientだけ架空snapshotに置き換えた。画面上にも「画面QA・架空データ・OS操作なし」と表示。provider・layout・metroの差替えは撮影用の一時worktreeだけに置き、製品のルートやビルドには含めていない。snapshotのOS状態は架空であり、実際の制限成功を示さない。保存やOS操作は実行していない。

## その他の検証と限界

Node v24.22.1。型チェック・lint・Jest 26 suites/250 tests・demo tooling 32 tests・通常のproduction Web exportがPASS。expo-doctorは18/20で、Expo schema APIの名前解決失敗とReact Native Directoryの応答エラーにより外部照合2件を完了できなかった。

既存の編集/未保存入力/処理中/利用不可のcomponentテストは固定ラベルに追従させ、通過。ネイティブコード・依存関係・保存契約・ルーティング処理は変更していない。Simulator、実機、VoiceOver、実際のDynamic Type、Screen Time/Extensionの挙動は未検証。今回の変更に新しいアニメーションはない。Reduce Motionを有効にしたブラウザで撮影した。
