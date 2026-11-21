# 一時解除・ホームの反映確認・スケジュールの検証

本体画面の対象は `5287beb22b130121571ca9b345d957e56c3c2c24`。変更する情報順と操作の参照は PR #268 の `1d1a1fc526d0fd2a251e30736b76fb064eb57bb2`。[Issue #270](https://github.com/kzk-maeda/itoma/issues/270) · [比較デモ](https://github.com/kzk-maeda/itoma/tree/1d1a1fc526d0fd2a251e30736b76fb064eb57bb2/demo/evidence)

## 本体画面

Chromiumで通常のアプリのルート、Provider、共通部品を使用し、合成のネイティブ応答とアプリ名を接続した。Lightは幅390px、Darkは幅320pxでDOM文字を175%に拡大。両方とも動きを減らす設定を使った。変更した操作の領域が44×44px以上で、画面が横にはみ出さないことを確認した。[操作結果](results.json)

| 画面 | 確認した操作 | Light | Dark・320px |
| --- | --- | --- | --- |
| 一時解除の確認 | 22:57に10分希望、23:00まで、最大3分。1分未満と期限切れ、期限後の送信なし、入力へ戻って理由を保持 | [要約](light-unlock.png) | [要約](dark-unlock.png) · [長い理由](dark-unlock-reason.png) |
| ホームの反映未確認 | 通知からスクリーンタイムへ直接移動。移動時の再反映0回、明示操作でのみ再反映。失敗後は通知を表示し、成功を確認できたらホームの解除入口を表示 | [通知](light-home.png) | [通知](dark-home.png) |
| スケジュールの全体停止 | 保存2件と個別の有効・無効を表示。再開の取消では送信なし、確定で再開、その後全体を停止 | [全体状態](light-schedules.png) | [全体状態](dark-schedules.png) |

## 自動チェック

- TypeScript、lint、Jest 373件、デモ32件、Expo Doctor 20項目が成功。
- Jestでは上記操作のほか、希望時間どおりの解除、短縮理由の特定が難しい場合、確認ボタンの連打、反映未確認と自動切替予定未準備の区別、未許可・再認可・正常な時間外、読取失敗時のスケジュール表示を確認した。
- 対応する受入条件は UI06〜UI13、UI17、UI19〜UI25、UI35、HD01・HD06・HD07、OH03・OH05。

## ブラウザ検証の再現

専用の作業ツリーで依存を導入する。`PLAYWRIGHT_MODULE` でPlaywrightのパス、`ITOMA_QA_CHROMIUM` でChromiumの実行ファイルを指定できる。

```bash
git apply --unidiff-zero docs/qa/restriction-decisions/web-harness.patch
EXPO_NO_TELEMETRY=1 EXPO_ROUTER_APP_ROOT="$PWD/src/app" CI=1 node --stack-size=4096 node_modules/.bin/expo start --web --port 8089
```

別のターミナルで実行し、終了後にサーバーを停止してパッチを戻す。

```bash
node docs/qa/restriction-decisions/check-browser.cjs
git apply --unidiff-zero -R docs/qa/restriction-decisions/web-harness.patch
```

## iOSでの検証範囲

通常のiOS向けJSバンドルを生成し、ソースマップで本体の3画面を確認した。通常バンドルとソースマップからブラウザ用の合成データを指す識別子は検出されなかった。HermesバイトコードのSHA-256は `825530b547fe3d2aebe34426929540dad7662d9e060504dd8b37fbee977b11c0`。

Simulatorの一般起動・ビルドはPRのActionsチェックを参照。Screen Timeの反映と解除、VoiceOverの読み順、Dynamic Type、iPhone上の確認ダイアログは実機未確認。ブラウザの文字拡大、アプリ名、ダイアログ操作には合成の入力を使用した。
