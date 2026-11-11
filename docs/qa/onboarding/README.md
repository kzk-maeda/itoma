# キャラクターなしの初回設定（#118 / #149）

PR #148を本人の指示でマージしたmain `0c22b4b43b0781a854e003de649b03842a99fe12`から実装。PR #116固定版`5329bf2`のキャラクターOFF、DESIGN原則1〜5、U01〜U08、UI01/UI02/UI07/UI08/UI13/UI17/UI20〜UI26/UI30/UI35/UI36を参照。

本人のタスクは、自分の時間を一つ決めてホームへ戻ること。任意の目的→曜日・時刻→許可理由とOS選択→確認の順に判断を分ける。意味トークンの「墨と白」、固定OPEN CIRCLE、短い導入、通常フォームを使う。目的を強制せず、未入力はホームの引用面ごと省く。初回設定と既存の再許可導線を分け、完了済み/既存利用者に導入を再強制しない。

## 保存・適用の検証

[具体的な保存/再開契約](../../system/onboarding.md)。private draftと初回完了、現在の認可、プロセス内の選択再確認、受理済みcommand、OS反映を別に扱う。許可/Picker/candidate準備だけでは開始しない。bindingの安定IDを先に保存し、確定を保存してから既存CommandServiceを実行する。policy commit後のprivate完了失敗は、同じbindingの照合とprivate完了だけで復旧する。

- 型/Lint、Jest 23 suites/155件（追加15件）、demoテスト、expo-doctor 20/20。
- Swift Storage 138件（追加7件）。旧schema互換、再open、CAS、破棄後の古い保存拒否、1行上書き、名前/目標と完了の一括rollback、後から編集/空保存した個人文を復旧時に上書きしないこと、未知補助schemaを初期化しないこと。1分/24時間を含む既存domain検証。Linux SQLiteでありiOS File Protectionの検証ではない。
- componentは任意目的、時間を先に決める順序、許可拒否、Picker取消、後回し/新provider復元、準備済みdraftの再確認、最終確定前の未開始、明示retry、既存利用者の移行、初回だけの導入、Simulator除外を確認。受理済み処理中にホームへ戻った場合も、処理中表示・二重開始不可・画面離脱後の正常完了を確認。
- providerは遅い保存中の入力を最新1件へ集約、古い応答による入力巻戻し防止、commit後に応答が失われた保存の復旧、破棄後に遅延autosaveが復活しないことを確認。

## 合成Webの操作と画像

Linux Chromium、390×844 Light、320×844 Dark、Reduce Motion、DOM文字/行高1.5倍（iOS Dynamic Typeではない）。変更した製品TS入力79ファイルのbyte照合は[source-verification.json](source-verification.json)。[manifest.json](manifest.json)に14条件の画像digest、可視操作44 CSS px以上、横overflowなし、page/console errorなし、操作結果を残す。

画像本体は、自動承認レビューでGitHubへの永続的な画像公開が未許可とされたため追加せず、検証workspace内に保持する。チャットで確認できるローカル画像であり、以下はファイル名。

| 条件 | ローカル画像 |
| --- | --- |
| 導入 | `welcome-light.png` / `welcome-dark-320.png` |
| 任意の名前と目的 | `purpose-light.png` / `purpose-dark-320-large.png` |
| 曜日/日跨ぎ | `schedule-light.png` / `schedule-dark-320-large.png` |
| 権限前/拒否/選択済み | `apps-before-permission.png` / `permission-denied.png` / `apps-selected.png` |
| 最終確認/反映失敗/予定として完了 | `review-light.png` / `application-failed.png` / `complete-scheduled.png` |
| ホーム | `home-scheduled.png` / `home-pending-dark-320.png` |

完走→見直し→失敗→本人retry→予定ホーム→再reload、後回し→準備中ホーム（入口1つ）→再reload→目的の復元を操作した。認可を勝手に要求しない、Picker取消で対象を変えない、最終確定までruleなし、失敗を成功扱いしないことも検証。WebのlocalStorageは合成portの再起動代替であり、Swift SQLiteの実保存証拠とは区別する。

## 再現

独立コピーに実体の`node_modules`を用意し、[root layout](proof-layout.tsx.txt)を`src/app/_layout.tsx`へ、[合成port](proof-providers.tsx.txt)をコピー内だけの`src/qa/onboarding-proof.tsx`へ置く。合成bridgeは`tests/fixtures/onboarding.ts`を使い、本体へQA route/fixture importを加えない。他の製品画面とproviderは変更しない。

`EXPO_PUBLIC_NATIVE_SMOKE=0 ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir dist`で19 routeをexportし、`npx expo serve dist --port 8173`と[capture script](capture.mjs.txt)で再現する。Playwright/Chromiumは検証環境の既存ツールを使用し、新しい製品依存は追加していない。

## iOSビルド・実機で残る確認

新しいSwift/Expo定数を含む署名無しiOSビルドの対象SHA・run ID・構成・Bridge smoke結果はPRへ記録する。PR #148の旧buildを今回のnative検証には流用しない。Simulatorで実際の認可・制限は行わないため、オンボーディングのOS成功や完走をcompile/smokeから推測しない。

実機QAは本人が後日実施する。#118/#131で次を確認する。

1. 新規インストールで導入→任意目的→曜日/日跨ぎ→実認可/Picker→確定→現在snapshotのホーム。拒否/取消/空/後回しでも入力を保ち、確定前は対象を制限しない。
2. 各stepで終了/再起動。目的/時刻/stepを復元し、以前の対象はPickerで再確認する。再許可だけで自動開始しない。
3. 最終確定の直前・適用中・policy commit直後に終了し、同じbindingから現在結果へ戻り、ruleが重複しない。失敗/不明は成功扱いせず、明示した復旧だけを行う。
4. 端末ロック中のComplete保護/保存失敗と復帰、キーボード/戻るgesture、VoiceOverの順序・選択・エラー、最大Dynamic Type、Light/Dark/Reduce Motion。Webの文字拡大やCSS寸法で実機合格にはしない。

初回設定は1 route内でstepを切り替え、画面を追加pushしない。writer/購読はrootに1組、保存は現在値1行で、stepごとのtimer/全文履歴を増やさない。実機のメモリ/UIView数はInstrumentsで別途確認する。
