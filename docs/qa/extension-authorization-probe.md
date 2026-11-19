# Extension認可のmain queue観測PoC

状態: **限定実験、製品への採用・根治・実機合格は未確定**。本人の「修正PoC進めて」という依頼でローカル実装する。関連#222/#131。GitHubへの掲載・Issue claimは、前段の自動承認レビュー拒否により未実施。本人の掲載承認を推測しない。

## 目的と比較対象

[23:30の実機記録](background-rule-start-diagnostics.md)で、Extensionはcallback/actor/open/serviceに成功した後、非メインスレッドの読取でnotDeterminedとなり、認可ゲートで止まった。本体復帰は同じbuildのown-store適用に成功した。本体も非メインなのでthread単独原因とは断定しない。

今回の比較は「callbackの制御処理を始める前にmain queueでAuthorizationCenterを初期参照・購読した場合」の初回値、通知、後続の既存評価結果。先行するmain参照自体が初期化を変え得るため、改善してもthreadだけの因果とは扱わない。既存buildのログを対照とし、同一processの2回目callbackも記録する。プロセスの新規/継続はimage UUIDとPIDで区別するが、OS cold起動を任意に強制したとは主張しない。

## 実装境界

- `ITOMA_AUTHORIZATION_PROBE=1`の明示opt-inだけで有効。CNGがhost/Extension双方へ`ITOMAAuthorizationProbe=true`を生成。既定とフラグを外した再生成はfalse。
- rule開始/終了、deadline終了callbackのentry後、Control actorのTaskとsemaphore joinを始める**前**に観測する。Control transactionやwriterを保持しない。
- main threadで入ったcallbackではprobeをskipする。main queueへ仕事を積んで自分で待たず、既存の制御処理へ進む。
- 非メインcallbackはmain queueへ非同期に**読取専用**の仕事を渡す。`authorizationStatus`を1回読み、`$authorizationStatus.receive(on: DispatchQueue.main)`の通知を観測する。初回notDetermined/未認識なら最大250msの通知待ち。approved/deniedなら早期終了する。認可要求・取消は呼ばない。
- 250msは今回の比較用待ち枠。callback全体の時間保証やshipping予算ではない。queue遅延/OS getter/ログ/取消の所要時間も別に観測する。sleep、busy loop、run loopの手動pumpは追加しない。
- windowを閉じた後の未開始jobはAuthorizationCenterへ触らない。既に開始したgetterは取り消せないが、遅い通知・ログは閉じたgateで拒否する。subscriptionの取消だけをmain queueへ送る。遅いcallbackから制御/OS設定を書き換える仕事は存在しない。
- 初回/通知のログはcallbackあたり最大4行、endに最終値とイベント件数を残す。既存の固定logger/allowlistを拡張し、本文・token・raw IDs等は出さない。
- probeの結果はControlの認可authorityへ渡さず、保存済みapprovedへの置換もしない。以後は既存のfresh evaluationと同期joinを実行する。未知なら制限適用を見送り、denied/本人停止の既存処理を保つ。

初期参照がOSの状態初期化を促し、既存の後続読取が変わる可能性はある。これはPoCが測る影響であり、明示的に初期値と後続の`authorizationRead`を比べる。本実装の読取経路修正は、この結果と同期callbackの設計レビュー後に分ける。

## 判定

| 観測 | 次の判断 |
| --- | --- |
| main初回approved/denied、既存評価も同じ | main参照/初期化が効いた候補。deniedは成功として扱わない |
| main初回notDetermined→通知approved | 初期化/非同期更新が有力。callback待ち枠・取消安全性の本実装設計が必要 |
| main初回/通知ともnotDetermined、後続も認可不明 | main参照だけでは解消しない。Extension内の情報取得条件を次の調査対象にする |
| probeTimedOutでauth=notRead | main job未開始/途中等を含み得る。OSのnotDeterminedと混同しない |
| probeSkippedMainThread | このcaseはmain queue比較を実施していない |
| 本体起動後だけ成功 | 引き続き背景開始FAIL。own-store acceptedだけを実Shieldの合格にしない |

unknownをapproveへ補完する、hostから過去の承認を共有して権限根拠にする、callback終了後のTaskへOS操作を任せる変更は含めない。#171の専用ring/復旧UI、Control/History schemaも変更しない。

## 検証と実機手順

`AuthorizationProbeWindow.swift`の実コードを、架空のqueue/status/取消で直接コンパイルして検査する。

```sh
mkdir -p .tmp/qa/authorization-probe
swiftc -swift-version 6 -parse-as-library \
  packages/itoma-screen-time/Sources/ItomaScreenTime/AuthorizationProbeWindow.swift \
  experiments/issue-222-authorization-probe/window-tests.swift \
  -o .tmp/qa/authorization-probe/window-tests
.tmp/qa/authorization-probe/window-tests
```

検査対象はmain自己待ち回避、timeout後job/通知拒否、通知上限、approved/deniedの区別、取消の後着race、別queueからの通知。fixtureが確認するのは観測gateのlifecycleだけで、iOS/Combine/Screen Timeの成立ではない。

型/lint/Jest/demo/iOS tools/doctorを実行。CNGテストでprobe既定false→true→falseを両plistで確認。実ビルドでは新SwiftファイルがPodsへ取り込まれること、署名付きhost+Extension、同Group/entitlement、Infoのprobe=trueを照合してから更新installする。旧PoC/native smoke/demoは0の通常画面を使う。

Podsの再生成時、既存CNGが本体用`ItomaHistory`のローカルpod参照を生成せず、`ItomaNative`の依存解決に失敗する不足も確認した。config pluginでhost target内だけへ参照を生成し、繰返しprebuildで重複しないこと、private HistoryがExtensionへ入らないことを検査する。既存lockの依存バージョンを維持し、生成ios/を正本として手編集しない。

本人の実機確認:
1. 他ルールと重ならないアプリAに、現在から3〜5分後の開始、開始から20分程度後の終了を保存。日付/曜日・日跨ぎに注意し、予定開始と終了を記録する。
2. 本体は背景へ移す（初回はkillしない）。開始後、本体を開く前にAのShieldを確認し、時刻を記録する。
3. 本体を開く前にOSログをローカルへ採取。`log collect`はattached deviceでpredicateが効かないのでraw archiveは送信しない。`log show`のsubsystem/category絞り込み＋allowlist scriptで抽出する。
4. 復帰時刻と、その後のAのShieldを記録。同一processの後続境界も別caseにする。

初回比較の後、認可取消中/再許可・全体停止・kill・一時解除期限・再起動/初回unlockを別caseで確認する。変更された認可/権限制御の採用はこのPoCだけで決めない。source SHA/JS digest/build ID/実構成・直接観測と本人報告・未実施を分ける。

## 一次資料

- [authorizationStatus](https://developer.apple.com/documentation/familycontrols/authorizationcenter/authorizationstatus): 初期値とmain queueアクセス要件。
- [DispatchQueue.sync](https://developer.apple.com/documentation/dispatch/dispatchqueue/sync(execute:)-3segw): 同じqueueへの同期dispatchはdeadlock。このPoCはmain.syncを追加しない。
- [Combine receive(on:)](https://developer.apple.com/documentation/combine/publisher/receive(on:options:)): 通知の受取queueを指定。willSet時の値を再読取せず、通知の値を使う。

## 2026-11-19 09:23の実機結果

SRE05/iPadOS27.2、source `2713db45f87a2fc844ca8df5ef359243129dea52`、local native build ID `b59148b4-a8e5-47d3-9f6c-1eb49a794155`、JS SHA256 `5afe19a977717a1c994dad4260c3e18a89f1c3e67176499f728be9f9be50a7ec`。host/Extension双方のprocessImageUUIDをinstall成果物のMach-O UUIDへ照合し一致。両plist probe=true、製品Screen Time=1、旧PoC/native smoke/demo=0。署名・実Group・容量/pending構成はbuild記録と同じ。

本人は09:23開始のルールを設定し本体を背景へ移した。09:24に対象アプリが開けたと報告。本体を開く前に本人がOS archiveを取得し、agentが固定診断行だけをallowlist抽出した。agentによる実アプリUIの直接観測ではない。

| JST | agentが診断ログから確認した事実 |
| --- | --- |
| 09:21:19 | hostの09:23境界登録APIがaccepted、開始前はrevision7/対象0件をown-storeへ反映 |
| 09:23:02.431 | Extensionのrule開始callback到達、probe開始 |
| 09:23:02.432 | **main queueの初回値notDetermined**。publisherから受け取った初回値もnotDetermined、main-thread true |
| 09:23:02.687 | probeTimedOut、観測2件、実測255ms。main job未実行によるtimeoutではない |
| 09:23:02.714〜.730 | actorのruntime open/service準備成功 |
| 09:23:02.734 | 既存評価側の読取もnotDetermined、Activation enabled、main-thread false |
| 09:23:02.743〜.747 | uncertain/authorizationRequired、callback全体316msで終了。制限適用ログなし |

**このケースでは、先行するmain queueの読取と250msの通知観測だけでは背景中の開始は解消しなかった。** 観測できた通知はpublisherの初回notDeterminedだけで、approved/deniedへの変化はこのwindow内にはない。永久に未確定、別の待ち時間なら成功、Extensionで承認済みを取得不可能、という結論にはしない。callback・main job・actor・open/serviceが進んだことと、認可ゲートで適用に進まないことを確認した。

次の調査対象はExtensionで認可状態が確定する条件/API契約。本PoCの待ち時間を根拠なく延長したり、過去approvedの流用・unknownの上書きで修正完了にしない。新しい認可要求や制御ゲートの変更は今回のPoCに含めず、別の限定設計/検証対象にする。本体復帰後の挙動は今回の取得windowには含まない。予定の登録API成功だけを実Shieldの成功にしない。生のarchiveはローカルのみで外部送信していない。
