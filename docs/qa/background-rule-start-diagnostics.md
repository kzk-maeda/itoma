# バックグラウンド中の開始境界を調査する

関連: [#222](https://github.com/kzk-maeda/itoma/issues/222)、通常フロー [#131](https://github.com/kzk-maeda/itoma/issues/131)。本書は調査・限定観測の記録であり、不具合解決や実機合格ではない。

## 2026-11-16の取得結果

本人報告: 22:30開始のルールを保存し、本体を強制終了せず背景へ移した。開始時刻に制限されず、ITOMAを開くと制限が始まった。これは本人によるShieldの観測で、agentの直接操作ではない。

agentは接続中のSRE05（iPad第9世代、iPadOS27.2）のアプリprivate History4をread-onlyコピーし、`quick_check=ok`を確認した。時刻はAsia/Tokyo。制御DBのApp Groupへの直接転送はCoreDeviceのcontainer access policyで拒否されたため、その経路からは採取していない。DBには理由等が含まれるので公開せず、下表に必要な時刻・固定状態・件数のみを抽出する。

| JST | durable記録の観測 | 解釈の範囲 |
| --- | --- | --- |
| 22:28:04.733〜.801 | policy revision 5、rule2件、enabled、対象0件、applied / ownStoreReadback。次境界22:30 | 保存済みルールに平日22:30〜23:00が存在。開始前の空のown-storeと整合 |
| 22:30:03.209 | 同revision / enabled、uncertain / authorizationRequired / writeAttempt、duration unknown、対象0件 | 開始時刻付近に制御処理が走ったが、認可確認のゲートで不確定になった。対象0件を選択消失やOSへclearした証拠と扱わない |
| 22:34:18.023 | 同revision、applying、対象1件 | 現在ルールの再評価へ進んだ |
| 22:34:18.054〜.094 | applied / ownStoreReadback、対象1件、期限23:00、duration restricted | 自分の設定のreadbackを確認。本人報告の復帰後の制限開始と整合。OS全体の連続遮断の証明ではない |

22:30:03から22:34:18まで約4分15秒は成功観測になっていない。振り返りへこの間を制限成功として補完しない。private DBは取り込み済み履歴なので、Extensionでの未取込記録や以後のイベントを網羅するとは限らない。

CLIの直近install記録はPR226 `d3f216b90df803f97bfa3e935869c8df725f107d`、local native build ID `80024b01-c53d-4272-9559-31b521481bd3`、JS SHA256 `e45ac1e463c963279d212750b091ca94971074295028e3e0ecbaa42580a811d7`、2026-11-16 20:08:51 JST。Xcode27.2(27B52)、iphoneos27.2、Release arm64、製品Screen Time=1、旧PoC/native smoke/demo=0、App Group `group.com.kzk-maeda.itoma`、履歴warning80MiB/maximum100MiB、pending10000。本体とExtensionの署名・Family Controls・同Group照合済み。本人の「元build」との同定は別途確認が必要。直前9467305とのnative製品ソース差分はない。履歴自体にはbuild/process/raw認可を記録していないため、上記はinstall台帳との照合情報である。

## 原因候補と未確定の境界

`AppleEvaluationContexts.context`はcustom ItomaControlActor上で`AuthorizationCenter.shared.authorizationStatus`を即時参照する。Appleは[初期値notDetermined、main queueのみでアクセス](https://developer.apple.com/documentation/familycontrols/authorizationcenter/authorizationstatus)と説明している。Extensionのcold初期化や実行queueは#222の調査対象であり、まだ根治したとは扱わない。

`Reconciler.canApply`はenabledのまま認可を確認できない場合にOS適用へ進まず、uncertain/authorizationRequiredを記録する。確定deniedは`CommandService.recordDenied`でenabledをawaitingReauthorizationConfirmationへ移す。その変化がない今回の記録はunknown経路と整合するが、raw値がnotDeterminedだったという直接観測ではない。

既存sourceIDは共有台帳のIDで、producer processを区別しない。「予定が呼ばれなかった」とは記録が整合しない一方、「22:30:03はExtension callbackだった」「OSが一度もShieldを適用しなかった」という断定もできない。記録の主体、raw認可、queue、open/makeService失敗、actor待ち、API結果の観測が不足する。

## 追加する限定logger

[ScreenTimeDiagnostics](../../packages/itoma-screen-time/Sources/ItomaScreenTime/AppleAdapters.swift)はOS標準[Logger](https://developer.apple.com/documentation/os/logger)のsubsystem `com.itoma.screentime` / category `lifecycle`へnoticeで出力する。Releaseにも含む。個人本文・native token・raw activity/command/registration ID・SQL・パス・生エラーは受け取らず、固定enumと数値だけを出力する。

- callbackEntry→actorEntry→runtimeOpen→serviceReady→reconciliationResult→callbackExit。例外は固定分類のcallbackError。uptimeからcallback全体の経過ms。
- raw認可のapproved/denied/notDetermined/unrecognizedと、読取時のmain-thread・Activation。context生成ごとの初回または値/Activation/threadの変化だけを記録する。同値の非出力は「認可を読んでいない」ことを意味しない。
- 予定登録begin/result、制限適用begin/resultと件数・policy revision、host refresh begin/end。
- timestamp、PID、sender/process image UUIDはOSのmetadata。行の前後とPIDで突き合わせる。独立callbackが重なる場合の一意な対応は保証しない。callbackExitは同期join終了を示し、reconcile成功は別のresultで判定する。

OS管理のbest-effortログなので容量/保持期間/完全性は保証しない。新しい専用ファイル・DB・ネットワーク送信・JS timer・共有ring・復旧UIは追加しない。専用ringの設計/保持/実装ゲートは[#171](https://github.com/kzk-maeda/itoma/issues/171)に残す。認可の読み方、判定、同期semaphore join、制御/履歴schemaは変更しない。

## 次回の採取

新Swiftを含むhost＋Extensionのbuildを使い、source SHA・JS digest・native build ID・構成を固定する。旧buildの再現を新loggerの検証へ転用しない。安全な対象Aと架空の理由を使う。

1. 平日等を合わせた開始数分後〜終了15分以後のルールを保存。予定開始、保存時刻、背景化、対象アプリを試した時刻を秒単位で別メモへ記録する。
2. 開始後、**ITOMAを開く前に**対象Aで実際のShieldを確認。ITOMAは背景/強制終了を別ケースで試す。
3. 復帰時刻を記録してITOMAを開き、再度Aを確認する。未取込の履歴を含めて復帰前/復帰後を区別する。
4. MacのConsole.appでSRE05を選び、subsystem `com.itoma.screentime`を絞る。未接続時を含む履歴採取には、Mac側で管理者権限が必要な`log collect`を本人が実行する。今回agentからのcollectは「rootが必要」で実施できなかった。admin認証を求めず、既存のprivate履歴で調査した。

以下は本人がrepo rootで実行する例。`.tmp`はgit除外済みであることを確認する。raw archiveは本人のローカルのみで扱う。

```sh
mkdir -p .tmp/qa/screen-time-log
chmod 700 .tmp/qa/screen-time-log
sudo /usr/bin/log collect --device-name SRE05 --last 30m --size 8m \
  --predicate 'subsystem == "com.itoma.screentime"' \
  --output .tmp/qa/screen-time-log/itoma.logarchive
/usr/bin/log show --archive .tmp/qa/screen-time-log/itoma.logarchive \
  --style ndjson --predicate 'subsystem == "com.itoma.screentime" AND category == "lifecycle"' \
  | node scripts/sanitize-screen-time-log.mjs > .tmp/qa/screen-time-log/events.ndjson
```

抽出scriptは既知の固定形式だけを採用し、他subsystem・追加文字・不正値・任意metadataを落とす。未知形式のログを安全のため落とすので、出力0行はcallback不在の証明ではない。raw archive/private DBをIssueへ添付せず、eventsの内容を確認し、必要な時刻範囲と画像UUIDだけを共有する。日時/行動の時刻自体も本人の情報である。

判定は次を分ける: callbackEntryなし（採取漏れ/保持切れ/別build/未配信を区別不能）、entryありactorなし（待ち/中断候補）、open/service失敗（固定分類）、notDetermined＋authorizationRequired（認可読取候補）、restrictionResult accepted（own-store読戻しのみ）、本体復帰後だけ成功（host復旧）。main queueへの修正は同期callbackとのdeadlock/初期化/時間予算を含む別PoC・レビューで決める。過去approvedを現在の権限に置き換えない。

## この変更の検証

検証結果・source/build情報はローカルQA記録に残し、レビュー用本文へ転記する。Simulator/UI QA、実機での新loggerのcallback、Shield開始/終了は今回未実施のまま別判定する。#222/#131や時間集計の親Issueを完了にしない。
