# Extensionからの直接Shield適用PoC

状態: 本人依頼の**限定実験**。製品の認可ゲート変更・採用・実機合格ではない。関連#222/#131。[main queue観測PoC](extension-authorization-probe.md)は2026-11-19の実機で初回/通知ともnotDeterminedとなり、250ms観測後も認可ゲートで停止した。

## 調べる問いと根拠

Extensionの認可値が未確定でも、本体で本人が選んだアプリのShieldをOSへ適用できるかを調べる。[AppleのDeviceActivityMonitor例](https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor)は、callbackでManagedSettingsStoreへ対象を設定する。例だけから製品の認可安全性やScreen Time成功を保証しない。

このPoCは製品のunknownをapprovedへ変換せず、過去の承認を権限根拠として渡さない。通常のCore/Control/History evaluator・DB schema・時間集計は変更しない。専用の実験経路が本人の明示登録を処理し、OSの実効制限を本人が観測する。成功時にも製品統合は別の設計/修正レビューとする。

## 範囲と解除

- opt-in: `ITOMA_DIRECT_SHIELD_PROBE=1`と`EXPO_PUBLIC_DIRECT_SHIELD_PROBE=1`。CNGがhost/Extensionに`ITOMADirectShieldProbe=true`を生成。既定はOFF。旧PoC/native smoke/demoは0の通常画面。
- 設定→「背景制限の検証」。通常ルールを明示的にすべて停止してから使う。nativeも最新のControl activation=pausedと製品own-storeのアプリ設定なしを要求する。
- native Pickerでアプリ1件だけ選択。カテゴリ/Webは不可。準備は開始約3分後の分境界、終了は開始から20分後という固定の絶対時刻。登録前に対象のApple表示と両時刻を確認し、確認dialogの承認で非反復OS予定を登録する。取消では登録しない。
- storeは`itoma.poc.direct-shield`、monitor namespaceは`itoma.directprobe.`。通常product/旧manual PoCのstoreをこの経路から変更しない。通常ルール等の制限が重なると、このstoreを解除しても利用できるとは限らない。
- 「今すぐ解除して検証を終了」は登録前/登録後/失敗時に使える。停止generationを共有ファイルへ保存してから、検証予定の取消と自分のstoreのclearを行い、読戻し結果を表示する。通常の全体停止でも専用検証を停止する。通常の再開/認可確認/ルール確定/解除確定等の操作は、先に専用検証を終了する。
- 通常の全体停止は、専用ファイルの停止が失敗しても通常ルールの停止を試す。その場合は成功表示にせず、未完了を返す。nativeファイル/OS障害時には終了を保証できず、手動解除の再試行とiOS設定から許可取消の手順を画面に残す。
- 期限のcallbackは現在の絶対時刻を評価してclearする。古いgenerationのcallbackは新しい実験を適用/消去しない。保存済みprepared/registeringでは適用しない。停止中の古いPicker/arm応答もgeneration照合で拒否し、Picker取消はPromiseを一度だけ完了する。
- 本体のsnapshotは制限を開始しない。期限を過ぎていた場合のclearは可能で、その観測元を「本体復帰時の期限後解除」と記録する。これをExtensionによる期限処理成功へ転用しない。

## 保存・並行処理・ログ

App Groupの`ITOMA-Control/DirectProbe/`に専用JSON1件（最大32KiB）とlockを保存。opaque tokenはnative-only、payload最大16KiB。raw token/名前/理由/目標はJS/URL/ログへ渡さない。UntilFirstUserAuthenticationのファイル保護・backup除外、ファイルmode0600。実機のFile Protection/再起動/競合成立は別ゲート。

host/Extension共通の1回nonblocking flockで最新記録の照合から短いown-store操作・結果保存まで直列化する。busyは適用を見送り、無限retryしない。callbackはnative actorの処理を同期joinしてから戻る。新しいJS timerやcallback後のOS変更Taskは作らない。期限の正確さ・処理時間予算・取りこぼしを保証したとは扱わない。

通常の認可取消を本体が観測したら、専用Picker/検証を取消する。背景中の認可取消/再許可をExtensionが確実に検出することは未確認で、OSの許可・失効動作と、実Shieldを別caseで検証する。readback一致を認可済みや端末全体の遮断成功へ読み替えない。

固定loggerのactivity=directProbe、directProbeSchedule/Apply/Clearを追加。本体復帰後の期限clearはprobeHostExpiry。生archiveはattached device採取のpredicateが無視されるためローカルのみで扱い、allowlist exporterを通した必要行だけを後日承認された共有へ使う。Issue作成・claim・PR/pushは以前の自動承認レビュー拒否に対する本人承認待ちで、今回はローカル作業のみ。

## 本人による実機確認

1. 設定→背景制限の検証。「通常ルールをすべて停止する内容を確認」で停止する。
2. 「アプリ1件を選んで時刻を準備」で、利用に支障のないAを選ぶ。ITOMAや連絡に必要なアプリを検証対象にしない。
3. 画面のA・開始/終了時刻を確認し、予定登録を承認する。予定登録成功はShield成功ではない。開始前にAが利用できることも確認する。
4. ITOMAを背景へ。開始後にITOMAを開く前にAを開き、時刻とShieldを記録。復帰前ログを採取する。
5. 終了時もITOMAを開く前にAが使えるか確認し、時刻とログを記録。途中で終了する場合は専用解除を使う。
6. 手動解除、通常の全体停止、古いcallback、認可取消/再許可は別case。取消後の再実験は再選択から行う。失敗はFAIL/未確認とし、通常の背景開始や時間集計の親Issueを完了にしない。

実機build ID/source SHA/JS digest/構成を固定し、本人報告とagentがログから観測した事実を分ける。画面の時間集計にはこの専用storeの時間を足さない。

## UIと検証範囲

利用者のタスクは「対象・期限を確認して、背景中の遮断を試し、いつでも解除する」。手順順に停止→準備→登録/状態を配置し、成功の断定を避けてreadback/実Shieldを区別する。既存Graphite/FlowScreen/Button/Apple labelを再利用。DESIGN原則1/3/4/5、U06/U07、UI06〜08/UI14〜16/UI21〜26/UI29を適用。新しい色/モーションは追加しない。

型/lint/Jest/demo/doctor、CNG opt-in/on→off、native compile/link/署名/両flagを検査する。Swift fixtureで固定期限、prepared/registering非適用、停止後・旧generation拒否、実flock競合、ファイル上限を確認。client/component検査で誤応答・取消・登録確認・解除導線を確認。fake token/OSを使う単体検査は実機のShield証明ではない。Light/Dark/最大文字サイズ/VoiceOver/gestureと画面画像は、matching buildで別途記録する。未確認のUI/OS結果を合格にしない。
