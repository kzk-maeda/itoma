# 初回設定の確認画面を整理（#149 / PR #151）

2026-11-12 JST本人依頼「各設定へ戻るボタンが並び、ややこしい」への対応。確認するタスクと修正するタスクを分け、最終確定を見つけやすくする。DESIGN原則1/3/4/5、U01/U07、UI21〜UI26/UI35/UI36に沿うレビュー対象であり、実機合格や設計Acceptedの宣言ではない。

## 調査と適用

| 一次資料 | 実装へ取り入れる点 |
| --- | --- |
| [GOV.UK: Check answers](https://design-system.service.gov.uk/patterns/check-answers/) | 入力の要約をグループ化し、その近くに変更操作を置く。入力済みの値を保持し、変更後は確認へ直接戻す。変更対象を読み上げで識別できるようにする。任意の未入力も明示する。 |
| [CMS: Button](https://design.cms.gov/components/button/) | 次へ進む主要操作と、項目を修正する補助操作の強さを分ける。低い強調度でもボタンとして操作できるようにする。 |
| [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | 主操作を明瞭にし、短い動詞のラベルと適切なタップ範囲を使う。 |

Webパターンの外見をそのまま移植せず、React Nativeのbuttonロールを維持する。3つの大きな「見直す」ボタンを廃止し、要約の「名前と目的」「曜日・時間」「許可と対象アプリ」に小さい文字の「変更」を添える。VoiceOver用の名前はそれぞれ「名前と目的を変更」等に分ける。文字を小さくしすぎず、44pt以上の領域を持つ。最終確定のみ塗りの主ボタン、後回し/破棄は補助操作とする。「変更」を押しただけでは有効policyを変更しない。

修正した項目の「変更を確認する」または戻るで、確認画面へ直接戻る。入力済みの名前・目的・時間・対象は保持する。1 route内で切り替え、step変更時だけScrollViewを作り直して先頭へ戻す。画面pushや購読を増やさない。戻り先は既存private draftの任意フィールドに保存し、後回し/再起動後も維持する。旧draftを読めるまま、対象アプリの再確認は独立したnativeの現在値で判定する。

## 検証

検証対象はこの変更の製品ソース。正確なcommit SHAとfresh native buildはPR #151に記録する。前回`382b139`の署名無しビルドは、このSwift変更の検証にはstale。

- PASS: 型/Lint、Jest 23 suites / 159件（今回追加4件）、demo 20件、expo-doctor 20/20、diff check。
- PASS: Swift Storage 139件。任意フィールドが欠ける旧draftのdecode、修正step/戻り先/目的/既存bindingの再open後保持を追加検証。Linux SQLiteでありiOSのFile Protectionは未検証。
- PASS: 確認の3つの変更操作と旧ボタンの撤去、目的/時間の修正後に直接戻ること、入力保持、任意の未入力表示、Picker取消後の既存対象保持、不正な時間での確定禁止。後回し/再起動後も直接戻れ、文字保存が対象アプリの再確認を省略しないこと、最終確定まで未開始も確認。
- PASS: 合成Webの24画像条件は横overflowなし、可視操作の高さ44 CSS px以上、page/console errorなし。Light/Dark、320/390px、Reduce Motion、DOM文字/行高1.5倍/2倍（iOS Dynamic Typeではない）。[manifest](manifest.json)に画像digestと操作結果、[source照合](source-verification.json)に製品TS入力79ファイルと合成fixtureのbyte照合を記録する。確認画面は上部/下部を別に撮り、主操作へスクロールで到達可能なことも目視確認する。

合成入力のみを使い、実データは含めない。画像本体はローカルworkspaceで確認し、digestと再現scriptのみを追跡する（前回、GitHubへの永続画像公開は自動承認レビューで許可されなかったため）。

再現は[前回の合成port](../onboarding/proof-providers.tsx.txt)と[root layout](../onboarding/proof-layout.tsx.txt)を独立コピーだけに配置し、そのコピーで`EXPO_PUBLIC_NATIVE_SMOKE=0 ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir dist`（19 route）と`npx expo serve dist --port 8174`でWeb export/serveする。本体へfixtureやQA routeは加えない。fixtureはプロセス再作成で対象確認を失い、単なる文字保存では確認済みに戻らない。[capture script](capture.mjs.txt)を実行し、[manifest](manifest.json)に操作結果と画像digestを残す。

実機で残る確認：iPhone SE第3世代のVoiceOverで各「変更」の対象を聞き分けられること、Dynamic Type/キーボード/戻るgesture、実Pickerの取消と再確認、許可取消、各修正中の終了・再起動と、最終確定の前に開始しないこと。Webの文字拡大・CSS寸法、Swift SQLiteテスト、SimulatorのBridge smokeとは分けて#118/#131へ記録する。
