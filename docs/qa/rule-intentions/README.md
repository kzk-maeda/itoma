# ロゴ・管理導線・ルール名と行動目標（#147）

本人指示によりPR145をマージしたmain `add65492451d1fa8f420aa5c8af9b40b8e4b4afc`から実装。DESIGN原則1/3/4/5、UI01/UI02/UI21/UI23/UI25/UI26/UI33/UI36/UI37/UI38を対象にする。

## 変更と保存の意味

- ホームの固定OPEN CIRCLEは「いとま」の前に置き、時間帯見出し横から撤去。
- 振り返りは集計・週/月・日別への導線を維持し、履歴一覧/取込/全記録削除を設定の「記録と振り返りの管理」へ集約。確認削除・取込後の失効を保持。
- 保存した各ルールから任意のルール名/行動目標を編集。未登録は時間帯N/引用面なし。登録した本人の目標を、ホームの円と対象アプリの間に表示する。
- 本体privateの独立SQLiteに現在値を保存。制限条件の編集と分け、名前/目標だけの保存でpolicy/rule version・OS予定・grant期限を変えない。失敗で入力を残し、競合は最新内容を確認後に明示保存。戻る/取消は未保存入力の破棄確認を伴う。

[保存契約](../../system/rule-details.md)。新しいSwift/nativeファイルがあるためPR145の既存端末buildはこの変更に対して **stale native build**。新nativeを含むbuildが必要。署名/登録/配布はこのagentでは実行しない。

## 合成Webの確認

画像本体のGitHub追加は自動承認レビューが永続公開を未許可として拒否したため、新PRには含めず検証workspace内に保持する。チャットで表示確認し、以下はローカルのファイル名。再現scriptとdigestはPRに残す。

Linux Chromium / viewport 390×844、320×800。Light/Dark、DOM文字/行高1.5倍（iOS Dynamic Typeではない）を使用。画像には合成データとWeb検証の明示を含め、実機画像やOS成功へ転用しない。

| 条件 | 画像 |
| --- | --- |
| ホーム | Light `home-light.png` / Dark `home-dark.png` / 320px大文字 `home-320-large.png` |
| 目標未登録 | 既存の時間帯名・引用面なし `home-unregistered.png` |
| 振り返り | Light `reflection-light.png` / Dark `reflection-dark.png` |
| 設定 | Light `settings-light.png` / Dark `settings-dark.png` |
| 名前と行動目標の編集 | Light `details-light.png` / Dark `details-dark.png` / 320px大文字 `details-320-large.png` |
| 保存失敗と保存後 | 入力保持 `details-save-error.png` / ホームの反映 `home-saved.png` |

[manifest](manifest.json)に11条件＋操作後2画像のdigestと結果を保存。横overflowなし、操作高さ44 CSS px以上、page/console errorなし。ロゴが文字より左、振り返りに管理操作がなく設定に各1つあること、保存失敗時の入力保持、保存後のホーム反映・再reload、metadata保存以外のOS操作を呼ばないことを確認した。

このWeb portはlocalStorageによる**合成の永続化**であり、Swift SQLiteやFile Protectionを通った結果ではない。破棄確認と競合時の最新表示/上書きはcomponentで検証。Swiftは再open/原文/空にして削除、2connectionの古いrevision、削除済みrule、未来schema拒否、失敗時の本文/整理/revision一括rollback、100更新で1行を検証した。

## 再現とsource

独立コピーで`npm ci --ignore-scripts`を実施し、[root layout](proof-layout.tsx.txt) / [合成port](proof-providers.tsx.txt) / [nativeラベル代替](proof-applications.tsx.txt)だけを差し替える。製品へQA route/fixtureを追加しない。[source照合](source-verification.json)は残る製品入力をbyte照合する（native testsも含むが、すべてがWeb bundleに入るという意味ではない）。本体private保存のSwift単体検証は別に実施する。

SDK58、`EXPO_PUBLIC_NATIVE_SMOKE=0 ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir dist`（19 static routes）、`npx expo serve dist --port 8163`と[capture script](capture.mjs.txt)で再現。Playwright/Chromiumは検証環境の既存ツールを使い、製品へ追加していない。

## 残る実機確認

新しい同headの署名無しiOSビルド/bridge smokeはPRへ結果を記録する。Web/Swift単体を実機成功とは扱わない。#131/#135で、新buildのルール名/目標の保存→終了/再起動→復元、Complete保護/端末lock、VoiceOver、最大Dynamic Type、キーボードと破棄確認/戻るgestureを確認する。

メモリについて、タブは固定3画面の再利用を維持し、private storeも過去の全文を追記しない。実機のUIView/UIHostingController数・メモリが反復操作後も増え続けないかはInstruments Allocations/Leaksで確認する。過去headのWeb反復結果で実機メモリを合格にしない。
