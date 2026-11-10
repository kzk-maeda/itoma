# 選択済みデモに合わせた通常ホーム・振り返り

対象 [#144](https://github.com/kzk-maeda/itoma/issues/144)、親 #56 / #99 / #100。
2026-11-10の本人指示に従い、[PR116](https://github.com/kzk-maeda/itoma/pull/116) `5329bf2` のキャラクターOFFホームと、[PR88](https://github.com/kzk-maeda/itoma/pull/88) `8892ad0` の累計固定＋週/月を通常のReact Native画面へ反映する。基点mainは `5d521f5862acf9d1305e226fc7a88d7d5636c49c`。

## 画面構成

| 画面 | 今回揃えた構成 | 継続する製品の条件 |
| --- | --- | --- |
| ホーム | いとま→時間帯見出し/固定OPEN CIRCLE→細い時間リング→対象アプリのフラットな行→共通一時解除（管理メニューは設定タブへ） | native snapshot・ルール別の終了時刻・アプリ別解除期限・認可/停止/失敗/不明を表示。大きな文字や320pt以下では小さい円と円の外の数値へ切替 |
| 振り返り | 見出し→累計/推移カード→週/月のセグメント→前後移動→期間合計→横棒の行 | 上部の対象は期間移動で変えない。月内clip週→日別操作履歴→戻ると期間の選択を保持。削除/取込の操作は下部の副導線 |
| 下部ナビゲーション | ホーム/振り返り/設定の3択。スクロールと別の領域に配置 | 既存Stackの `/` / `/reflection` / `/settings` を使い、root Providerの選択位置を保持。選択中のタブは画面を追加しない |

原則1/3/4/5、U01/U02/U04/U05/U07/U08、UI01〜UI04/UI14〜UI26/UI28/UI33〜UI36、RF01/RF05〜RF11に対応する変更。全条件の合格宣言ではない。

デモのHTML・比較パネル・端末枠・仮のステータスバーを製品に埋め込まない。本人の目的は未登録なので引用カードを捏造せず、キャラクターも置かない。アプリ名/アイコンは従来のApple native viewから取得する。Swiftの制限/予定/保存・bridge・providerは変更していない。

時間の定義は本人指定どおり**実際に制限を続けた時間から一時解除を除く**。現行のpoint-only製品DTOは時間を確定できないため、累計/期間/横棒の値は「—」と集計準備中。デモの84時間等、設定予定、0を代用せず、未知区間の折れ線もつながない。正値の計上根拠は #98 に残る。

## 実機UIフィードバックへの対応

本人からの実機観察を受けた修正で、このagentが同じ端末で直接再確認した結果ではない。

- 表示中の週次/月次を再選択してもrequestを変えず、再取得やアニメーションを開始しない。
- 期間取得中は前の有効な表示を保持し、読込テキストを途中へ挿入しない。新しいDTOが届いたときだけ、上部累計を残して期間部分を16pt/180msの短いスライドへ切替。週/月の選択面も同じ時間で移動する。演出終了を操作条件にはしない。
- Reduce Motionの初期値と動的変更に追随し、途中の演出を止めて静止表示へ戻す。アニメーションを積まず、データの更新・削除・sourceの失効を優先する。
- ホームの15秒ごとのsnapshot再取得は、制限状態の鮮度を保つため継続する。以前は毎回refreshKeyも増え、SwiftのSavedApplicationsView.reloadがアプリ表示を一度空にして非同期で読み直していた。refreshKeyを認可/保存対象の変更と明示的な再確認に限定し、Applicationsをmemo化した。秒表示や観測時刻だけの更新でnativeラベルを読み直さない。
- ホームの「ルールと設定」「選択の記録を見る」「現在の状態を確認する」を撤去。設定タブへルール編集・停止/再開・履歴・手動状態確認をまとめ、必要な復旧操作を保持する。

[motion-manifest.json](motion-manifest.json) / [フレーム記録](motion-frames.json) / [切替動画](period-switch.webm)に、合成Webでの確認を保存。350msの読取遅延を注入して旧期間/累計node/表示位置の保持、再選択時の読取回数不変、選択面と期間内容の途中位置、月の前後移動、Reduce Motion変更、設定/履歴往復を確認した。[motion capture script](motion-capture.mjs.txt)を使用する。録画時だけ表示時計を固定基準時刻＋performance.nowで進め、JSアニメーションを計測する。実機のフレームレート・ちらつき解消やOS制限の保証ではない。

## Webの画面・操作確認

[manifest.json](manifest.json)に17ケースのPNG digest・条件・エラー・操作結果を保存。
すべて**合成native入力を使ったLinux Chromium**で、iPhone実機の画像ではない。375×667はSE相当のCSS viewportにすぎない。1.5倍はDOMの文字/行高変更であり、iOS Dynamic Typeではない。

| 条件 | 画像 |
| --- | --- |
| ホーム Light / Dark | [Light](home-light.png) / [Dark](home-dark.png) |
| ホーム SE相当 / 320px・文字1.5倍 | [SE相当](home-se.png) / [狭幅・大文字](home-320-large.png) |
| ホーム 未設定 / 反映不明 / 一時解除中 | [未設定](home-empty.png) / [不明](home-uncertain.png) / [解除中](home-grant.png) |
| 月次 Light / Dark | [Light](reflection-light.png) / [Dark](reflection-dark.png) |
| 月次 SE相当 / 320px・文字1.5倍 | [SE相当](reflection-se.png) / [狭幅・大文字](reflection-320-large.png) |
| 設定 Light / Dark / 狭幅・大文字 | [Light](settings-light.png) / [Dark](settings-dark.png) / [320px・文字1.5倍](settings-320-large.png) |
| 振り返り 削除後 / 未記録 / 読取失敗 | [削除後](reflection-deleted.png) / [未記録](reflection-unrecorded.png) / [失敗](reflection-error.png) |

画像は固定viewportで取得し、ScrollViewのclipを外していない。全ケースで横overflowなし・page/console errorなし・操作高さ44 CSS px以上、末尾の操作へスクロールで到達し下部タブに隠れないことを計測する。目視でも円・数値・対象・期間切替・下部タブを確認する。

通常URLからホーム/振り返りを100回往復し、選択中の2026年12月・3つのタブ・browser historyの長さ3を維持。月→月内clip週→日別履歴→戻るも操作した。理由全文のブラウザ操作・実機memory/購読/OS処理はこの計測に含めない。コンポーネント検証では解除理由の保持/破棄、固定期限、削除競合、月/週/日/理由の復帰とprovider購読のcleanupを確認する。

## 再現・sourceの照合

検証用の別コピーだけで [root layout](proof-layout.tsx.txt) / [合成port](proof-providers.tsx.txt) / [native表示の代替](proof-applications.tsx.txt) を使用する。通常の製品routeと画面/Provider/parserはそのまま使う。製品側へQA routeやfixture portを追加しない。

[source-verification.json](source-verification.json)で、root layoutとアプリ表示の代替以外の製品source fileが同一byteであることを照合する。実行時のinput file digestはcommitへ追記する自身の文書/PNGを除いたsourceの照合であり、実機binaryのdigestではない。

新しい検証コピーで `npm ci --ignore-scripts` を行い、SDK58の `expo export --platform web --clear --output-dir dist`、`expo serve dist --port 8161` と [capture script](capture.mjs.txt) を使う。環境値は `EXPO_PUBLIC_NATIVE_SMOKE=0 ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_OFFLINE=1 CI=1`。出力/URL/Chromiumのパスは環境に合わせる。Playwrightは検証環境の既存依存を使い、製品へ追加していない。

共有node_modulesのsymlinkを使った初回exportは別のrouter rootを解決したため証跡から除外。独立した依存を導入し、cacheを消して通常15 routesのexportを再生成したものだけを使用する。

## 検証範囲

- 型チェック・Lint・Jest 16 suites/121件、demo 20件、iOS tools 18件が成功。expo-doctorは直接接続で外部2チェックが失敗した後、環境のproxyを利用して20/20成功。
- 新しい同headの署名無しSimulator検証はPRへ結果を記録する。Web/JestをSimulatorのUI操作やScreen Time成功へ転用しない。
- iPhone実機でのnativeアプリ名の折返し、最大Dynamic Type、VoiceOver結果通知/復帰focus、Reduce Motion、Safe Area、戻るgesture、Screen Time/Extensionは #131/#135 に残す。新しいJSを含むbuildで確認する。既存の署名無しbuild/PR124を今回の画面変更の成功証拠へ付け替えない。
