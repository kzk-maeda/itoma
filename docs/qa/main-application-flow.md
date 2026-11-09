# 通常アプリフローの確認と実機への引き継ぎ

対象: #103 / #127 / #129、PR #128 / #130。通常ホームから、認可、アプリ選択、曜日・時間帯ルール、理由付きの一時解除、解除状況、早期終了、ルール編集・削除、全体停止・明示再開、理由削除までを接続する。

## 画面と確認済みの範囲

DESIGN原則1〜5、U01〜U07に従い、状態と問題、時間帯ごとの円、対象、次の操作の順に表示する。基本配色は「墨と白」。目的は未登録なので引用面を作らない。解除の対象・ルール・理由全文・期限上限を確定前に確認できる。保存と制限の反映を分け、不明を成功と表示しない。起動時のテンプレートExpoアニメーションは外し、Light/Darkの背景を揃えた。最終ブランドアイコンの制作は別作業。

| 確認層 | 記録と限界 |
| --- | --- |
| React component | `tests/main-flow.test.tsx`。空白/範囲外入力、対象初期未選択、確認と取消、入力保持、固定期限、failed/uncertain、別対象の早期終了、認可と明示再開、編集中の入力を別操作で上書きしないこと。fixtureのPagesは実際のnative Stack/gestureではない |
| 表示と既存テスト | TypeScript/Lint/Jest、demo検査、CNG/QAツール、expo-doctor。OS制限を実行するテストではない |
| Web画面記録 | 下記9条件。合成native入力で表示を検査。Nativeアプリ名は合成表示へ置換。実機QAと別 |
| 署名なしNative QA | 対象headのActions結果をPRへ記録。共通Swiftテスト、CNG、host/Extension compile/link/embed、Simulator install/launch/bridge、ホームLight/Dark画像。Simulatorのproduct bridgeは利用不可を返す |
| 実機 | **この変更の実機結果は未記録**。PR #124の手動PoC結果を、product store/新Extension/通常画面の成功へ転用しない |

対象受入ID: UI01〜UI21/UI26の入力・状態・復旧経路、UI22/UI23/UI35のWeb表示、UI25/UI32の可視時だけの表示clockとcleanup。UI24 VoiceOver、UI07 gesture、UI22 Dynamic Type/実機keyboard、UI25/UI30のiOS操作・往復計測は実機で残す。IDへの対応は全項目合格の宣言ではない。理由は端末内のprivate Historyへ保存し、token・実理由・アプリ実名をURL/ログ/画像へ含めない。

## Web画像の出所

画像の製品コードは `4fbd85407881aff78cfe0bdb55163ceb9e2a489c`。後続の画像・文書コミットは表示コードを変えない。時刻を `2026-11-09T21:30:00Z` に固定したLinux Chromium。データは架空で、上部に「合成データによる画面QA · OS制限は未検証」と表示する。画像・bundleのSHA256、browser版、幅、実行エラーは [manifest.json](main-flow/manifest.json) に記録する。

| 画像 | 条件 |
| --- | --- |
| [home-light](main-flow/home-light.png) / [home-dark](main-flow/home-dark.png) | 390×844、時間帯と2対象 |
| [rule-narrow](main-flow/rule-narrow.png) | 320×800、曜日・時間・スイッチ |
| [review-large-dark](main-flow/review-large-dark.png) | 320×800、長文、DOM文字/行高を人工的に1.5倍。iOS Dynamic Typeではない |
| [grant-light](main-flow/grant-light.png) / [failed-dark](main-flow/failed-dark.png) | 固定期限の状況、失敗時の復旧 |
| [settings-light](main-flow/settings-light.png) / [empty-light](main-flow/empty-light.png) | 設定と未設定 |
| [unlock-short-viewport](main-flow/unlock-short-viewport.png) | 390×440、入力focus後に確認ボタンまでscroll。iOS keyboardではない |

9条件で横はみ出し、page/console errorなし。短いviewportでも確認ボタンへ到達できることを計測した。通常の8画像はscroll祖先の高さ/clipを撮影時だけ外した**全内容の書き出し**。固定viewportのnative screenshot、gesture、OS制限、実機アクセシビリティの証明ではない。

再生成用の [fixture](main-flow/proof.tsx.txt)、[アプリ名の合成表示](main-flow/applications.tsx.txt)、[capture script](main-flow/capture.mjs.txt) を保存する。fixtureは製品routeへ追加しない。検証用の別コピーでのみ、前者を `src/app/proof.tsx`、後者を `src/components/flow/applications.tsx` へ配置する。Node依存は製品と同じものを使用した。

`ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_PUBLIC_NATIVE_SMOKE=0 EXPO_PUBLIC_BUILD_SHA=<上記SHA> EXPO_OFFLINE=1 CI=1 npx --no-install expo export --platform web --output-dir <一時出力先>` で生成し、extensionless URLをHTMLへ解決するlocalhostサーバーで配信する。capture scriptのoutput/dist/URL/Chromiumの各パスは環境に合わせて変更する。Playwrightは環境に既存のものを使用し、製品依存には追加していない。export/撮影はローカルであり公開ではない。

## 実機ビルドへ渡す前提

実機操作と署名設定はowner/実機QA担当が行う。以前のTeam未登録という回答だけを現在の阻害条件に戻さず、PR #124の実績を引き継ぐ。一方、新ExtensionのApp Groupアクセスと署名は別途確認が必要。

1. PR #128/#130を含む固定40桁source SHA、JS SHA、native build ID、Xcode/SDK、生成構成digestを記録する。OTAだけで新native機能が入ったと扱わない。
2. ownerの既存bundle ID/Team/署名設定を保持する。hostと `ItomaActivityMonitor` の両方にFamily Controlsと同一のowner管理App Groupが必要。CI用 `group.com.example.itoma` は実機アクセスの証明ではない。登録/購入/申請/署名変更が必要ならowner側の判断事項として残す。
3. 製品pluginを `ITOMA_SCREEN_TIME=1` と `ITOMA_APP_GROUP=<ownerのgroup>` で有効にする。`ITOMA_HISTORY_WARNING_BYTES` / `ITOMA_HISTORY_MAXIMUM_BYTES` / `ITOMA_PENDING_EVENT_LIMIT` も明示する。CI候補は83886080 / 104857600 / 10000だが、出荷値の採用ではない（#42）。`ITOMA_SCREEN_TIME_POC=1` だけでは製品機能は入らない。
4. CNGの正本はplugin/Extension/各module。既存のprivate設定を保持して `npx --no-install expo prebuild --platform ios --no-install --no-clean` を使用する。SDK58は既定でnativeを再作成するため `--no-clean` を省略しない。生成された `ios/` へ正本のSwiftを手書きしない。新規検証checkoutなら元のowner設定を先に再現する。
5. 生成workspaceでhostと埋込Extensionを含む対象buildをownerが用意する。Simulator/Web/Expo Goで「この環境では利用できない」は正常な判定であり、実機成功ではない。

構成/保存/期限アダプタの詳細は [screen-time-runtime.md](../system/screen-time-runtime.md)。private HistoryはComplete、共有Control/monitorはUntilFirstUserAuthenticationとbackup除外を設定している。実機の保護・プロセス競合・初回unlock前の挙動は未検証。Controlやmonitorの破損時にDBを自動初期化しない。

## 通常フローの実機QA

最初は支障のないアプリA/Bを使い、入力理由は架空の文章にする。端末/OS（利用者申告: iPhone SE第3世代/iOS27.0.1、PR #124の試験端末は別）、build/source/JS/config、現地timezone、予定時刻、操作時刻、観測した結果を各ケースに付ける。許容遅延・反復回数は #26 の採用判断であり、ここで新たな合格閾値を決めない。

1. **導入と選択:** 通常ホームから許可→A/Bをnative Pickerで選択→曜日・近い将来の開始/終了→確認→保存。取消では旧設定不変。既存手動PoC storeが残っていれば画面の明示停止を行ってから進む。旧token/DBの自動移行はしない。
2. **時間帯:** 開始前、開始後、終了後にA/Bを実際に開いて観測する。ホームの予定と現在状態を記録。日跨ぎと複数ルールの重なりも別ケースにする。ITOMA表示やown-store readbackだけでOS全体の遮断を断定しない。
3. **理由付き解除:** 共通入口→初期未選択→Aを選択→架空理由/1〜30分→適用ルール/理由全文/実効上限/他対象継続→確定。入力へ戻ると値を保持し、破棄で新grantを作らない。Aのみ利用でき、Bが制限されたままかを実観測する。
4. **JS/本体停止後の期限:** 確定した絶対期限を記録し、ITOMAを強制終了。期限を過ぎたら **ITOMAを開く前にAを開いて** 再制限を観測する。その後ITOMAを開き最新状況を取得する。再起動時のhost reconcileだけで直った場合は、Extensionによる期限処理成功とは区別する。offline、端末再起動/初回unlockも別々に実施する。
5. **期限と復旧:** 優先ルール境界で短縮された解除、確認画面で待機、連打、背景復帰を試す。期限が延びないこと。failed/uncertainは成功表示せず、明示再試行が同じcommand/固定期限を使うこと。登録不能な場合は新しい解除を行わないこと。OSエラーを発生できなければ未実施とする。
6. **終了と設定:** Aの早期終了が別対象の解除を終了しないこと。ルール編集/削除の影響確認、全体停止→再起動→停止保持→明示再開、入力中の別ルール操作の破棄確認。理由削除がルール/現在grantを変えないこと。
7. **認可:** 取消をアプリが観測した場合の未適用表示、再許可→対象選び直し→明示再開。取消と再許可をITOMA停止中に済ませるケースも別途記録する。観測の間に完結した変更を必ず検出できるとは未検証。
8. **端末UI:** Light/Dark、320pt相当の狭さ、長いnative名/理由、最大Dynamic Type、日本語IME/keyboard、VoiceOver順序/選択/戻ったfocus、Reduce Motion、戻るgesture/入力破棄、繰り返し往復を実操作で確認する。

daily 15分monitorでの曜日境界、過去開始を使う短いgrantのAPI受理、終了callbackの早着/遅延、活動数上限、timezone変更、kill/再起動後の配信は #26/#49〜#52の物理ゲート。receiptは配信保証ではない。手動で初めて遮断を観測した時刻を、計測していないcallbackの正確な時刻と混同しない。再現不能・未実施・失敗を区別し、結果は専用の実機QA Issueへ追記する。これらが残る間は #103やOS連携の親Issueを閉じない。
