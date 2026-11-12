# 時刻Pickerと日付またぎの自動判定（#149 / PR #151）

2026-11-12 JST本人依頼。開始/終了の文字入力と日付またぎの手動チェックを、時刻の選択と読める時間帯へ置き換える。初回設定と通常のルール作成/編集で共通部品を使う。DESIGN原則1/3/4/5、U01/U07、UI20〜UI26/UI35/UI36を参照する。

## 入力と確認

iPhoneは既存依存`@expo/ui` 58.0.27のSwiftUI `DatePicker`（hourAndMinute / wheel）を使う。追加依存・Swift・entitlement・共有保存の変更はない。開始と終了をタップして選び、「この時刻にする」で下書きへ反映する。開いただけ、ホイールを回した途中、キャンセルでは以前の値を保つ。未選択から開くと現在の時刻を候補にするが、確定するまで補完しない。Pickerを閉じればunmountし、routeをpushしない。

| 選んだ時刻 | 表示と保存する終端 |
| --- | --- |
| 21:00 → 23:00 | 21:00〜23:00、当日 |
| 23:00 → 02:00 | 23:00〜翌02:00、翌日 |
| 23:59 → 00:00 | 23:59〜翌00:00、1分 |
| 21:00 → 21:00 | 21:00〜翌21:00（24時間） |

「翌日に終了する」のcheckbox/switchは撤去。曜日は開始日と説明し、選択中と最終確認の両方で終端を見せる。同時刻を黙って終日として適用せず、24時間と明示した内容を最終確定して初めて既存の適用要求へ進む。Native `WeeklySchedule`の範囲とday offsetを維持し、変更/Picker/previewだけでは開始しない。

Picker内の`Date`はUTCの固定日を時分の入れ物としてだけ使う。表示用のtimeZoneもUTCに揃え、端末のDSTで02:30等が別の時刻へ補正されることを避ける。保存は従来の時分/翌日フラグで、選択する時刻とルールの評価は端末の現地時刻のまま。実際の日付やUTC instantをルールとして保存しない。

APIの根拠は[Expo SDK58 DatePicker](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/datepicker/)、[Host](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/host/)、[modifiers](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/modifiers/)とインストール済み58.0.27の型/Swift実装。Hostに横幅を与え、縦だけを内容に合わせる。墨と白のtheme・44pt以上の操作・スクロール・通常のキャンセルを維持する。

## 検証と再現

- 型/Lint、Jest24 suites/163件、demo20件、expo-doctor20/20、diff check。JestのOS wheelだけを置き換え、製品のModal/入力確定/取消/下書き/確認を実行する。
- 初回設定と通常ルール編集で当日/翌日/同時刻24時間、1分、未選択/不正形式、入力保持・取消・最終確定前の未開始・明示retryを確認。既存の再起動/再確認/accepted commandの試験も継続。
- 合成Web34画像条件は横overflowなし、page/console errorなし。時/分のbounded selectで代替する。**WebのPicker画像はiOSのホイール画像ではない。** Light/Dark、320/390px、Reduce Motion、DOM文字1.5/2倍、Picker取消/再選択、確認への直接復帰、後回し/再起動を操作。[manifest](manifest.json)に条件、画像digest、overflow/操作高/error、[source照合](source-verification.json)に製品TS入力84ファイルとfixtureのbyte照合を記録する。新しい時刻操作と各ボタンは44 CSS px以上。通常ルール編集に以前からある有効/無効SwitchはWebで見た目の高さ20pxのため、その寸法を別に記録し44px達成とはしない。iOSでは既存のSwitch/hitSlopを維持し、実機の操作範囲は後日のQAで確認する。

検証用の独立コピーで[前段のroot layout](../onboarding/proof-layout.tsx.txt)と[合成port](../onboarding/proof-providers.tsx.txt)を配置し、`EXPO_PUBLIC_NATIVE_SMOKE=0 ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir dist`（19 route）と`npx expo serve dist --port 8175`を実行する。[capture script](capture.mjs.txt)は`ITOMA_QA_OUTPUT`で画像/manifest出力先を指定できる。製品へfixtureやQA routeは加えない。画像本体は前回の自動承認レビューでGitHub永続公開が許可されなかったためローカルに保持し、再現scriptとdigestを追跡する。

対象commit / JS bundleとfresh iOS buildの結果はPR #151へ記録する。前段9bb55d4の画像とbuildを今回のPicker UIの検証とは扱わない。署名無しビルドのcompile/Bridge smokeはホイール操作の実機合格ではない。

実機QA（#118/#131、本人が後日）：iPhone SE第3世代でホイールの24時間表示・1分単位・確定/キャンセル、23→翌2/同時刻24時間の確認、VoiceOverの選択値とModalのフォーカス復帰、Dynamic Type/狭幅、外観、タイムゾーン変更、終了/再起動を確認する。実認可・Picker・制限・File Protection・実機メモリは既存の別ゲートを維持する。
