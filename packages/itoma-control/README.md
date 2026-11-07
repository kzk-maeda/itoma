# ItomaControl

[#83](https://github.com/kzk-maeda/itoma/issues/83) / 親[#47](https://github.com/kzk-maeda/itoma/issues/47)。Coreと共有ItomaStorageに依存するnative controller。UI/JS/Expo/Screen Time/private本文には依存せず、本体とExtensionが同じSwift制御を使うためのpackage。実OSのadapterは別に接続する。

## 新規解除の契約

本体がprivate理由/選択を確定保存し、shared Pending grant/commandを受理してから`executeAcceptedGrant`を呼ぶ。controllerは本人の入力保存を推測しない。`ItomaControlActor`はprocess内の順序を管理し、他processは共有SQLite writerで調停する。actorそのものはOSとのatomicityを保証しない。

1. 最新policy/contextで未失効を確認し、Scheduling/Preparingをwriter TXでcommitする。
2. lock外でDeadlineSchedulerをawaitする。重複呼出しは二重登録せず、再起動等で残ったScheduling/Applyingは復旧を要求する。
3. 一致するreceiptを別TXでcommitする。登録失敗/不明、receipt保存失敗なら新解除を適用しない。
4. 現在の前提を確認し、OS操作前にcommand/grant/観測のApplyingを別TXでcommitする。結果保存のrollbackで過去のAppliedが現行の証拠に戻らないようにする。
5. 最終writerで自分のApplying evaluationID、base、現在時刻/zone/認可/Activation、未失効、最新登録/receipt/未発火を再確認する。別processが観測を更新済みなら、古いmarkerからOSを操作しない。Coreの評価を使い、TSへルールを複製しない。
6. 自分のstoreへ短い同期Restriction操作を行い、grant/command、有限のEvaluation/ApplicationObservation、本文なしoutboxをcommitする。書込試行とOS全体の制限を混同しない。

登録済み保護予定を先に取消さない。適用後に結果commitが失敗したらUncertainを返し、DB rollbackをOS rollbackと説明しない。期限/zone/時計が同期操作中に変わった場合もActiveを確定せず、保護receiptを再確認した最新baselineを試みる。補償操作の後もcontext/境界を再検証し、再び変化したらUncertainへ落として再帰的なapplyをしない。

認可Unknown/DeniedはCoreが返す空集合をstore削除へ変換せず、追加applyを止めてUncertainを保存する。確定Deniedをenabled状態で観測したら全grantを失効し、Activationを確認待ちへ移す。Approvedへ戻っただけでは再開しない。本人の停止済みpaused意図は維持する。停止/再制限の完全なReconcilerは#85へ続く。

他のActive grantも、現在の実効期限に一致するRegistered/未発火receiptと有効化済み候補の記録を確認する。候補準備中は旧有効receiptを保持でき、未確認のActiveフラグだけでは解除しない。

全grantについてCoreが返す失効/期限切れ/不明のrecordを保存する。planだけから除外してActiveを残さず、timezone/認可が元に戻ったときに同じgrantを復活させない。

`retryGrant`は本人の明示再試行。元grantID/初期上限/実効期限を維持し、新attempt/登録世代へ進む。自動再送ループ、画面破棄に伴うcancel、追加待機/回数制限を入れない。

## 保存・観測

control schema5は最新Evaluation/ApplicationObservationだけを追加する。schema1〜4から本体が明示移行し、旧DBの観測はnilのままで成功を捏造しない。Evaluationの版/sequence、有限boundary、observationのID/evidence/有効時刻を検証する。policy/snapshotの版とOS観測の有効性は別。

`committed`は結果metadataのcommitを意味する。UIはcommandの状態とobservation/evidence/validUntilを読む必要があり、過去のcommand成功だけから現在のブロック状態を宣言しない。fakeの`.writeAttempt`/`.ownStoreReadback`は実OS証拠ではない。

## 検証

Swift 6以降とSQLite開発ヘッダー:

```sh
swift test --package-path packages/itoma-control --jobs 2
```

repo rootでCIと同じ固定imageを利用:

```sh
docker build -f .github/docker/swift-tests.Dockerfile -t itoma-swift-tests .github/docker
docker run --rm --network none \
  --mount "type=bind,src=$PWD/packages,dst=/packages,readonly" \
  itoma-swift-tests sh -c '
    swift test --package-path /packages/itoma-core --scratch-path /tmp/core-build --cache-path /tmp/swift-cache --jobs 2 &&
    swift test --package-path /packages/itoma-storage --scratch-path /tmp/storage-build --cache-path /tmp/swift-cache --jobs 2 &&
    swift test --package-path /packages/itoma-control --scratch-path /tmp/control-build --cache-path /tmp/swift-cache --jobs 2'
```

managed cloudのDocker/proxy/CAはruntime手順に従う。テストは通信なし・ソースread-only、生成物/DBは一時領域。fake I/Oと実SQLiteでawait/commit境界、重複、期限、登録/保存/同期適用の失敗を注入する。iOSビルド・Simulator・実機・App Group・Screen Timeの証拠ではない。

## 候補編集・複数grantの短縮

[#84](https://github.com/kzk-maeda/itoma/issues/84)の`previewCandidate`/`executeAcceptedCandidate`は、Coreの確認内容を入口・登録後・最終writerで照合する。現在policy/contextに由来する失効は候補とは別に先に保存し、そのcaptured contextを確認に再利用する。候補のモード/ルール変更による失効は、候補有効化まで適用しない。

- 全shorten grantのPreparingを一括commitし、lock外で登録、receiptを別commitする。1件の失敗/不明/保存失敗でも旧policy/期限/保護を維持する。
- baseの古い候補はSuperseded。確認対象・context・影響が変われば未反映のまま再確認を要求する。`retryCandidate`は未有効化のFailed/Uncertainに新attemptを付け、古いAPI応答が新attemptを失敗させないよう照合する。
- OS前のApplying markerは有効なbase contextを表し、候補を現在のpolicyとして見せない。最終marker照合後、全grant変更とpolicyを原子的に有効化し、同期plan・結果/観測を保存する。
- 登録済みの希望policyは、store操作が失敗/不明でも保存できる。その場合は適用済みとせず旧保護を取り消さない。既に有効化した候補をbase+1として再実行せず、最新状態のReconcilerへ進む。
- 必要な新保護と新状態の成功commit後だけ、lock外で不要な旧予定を取消す。取消不明は記録し、新期限を延長したりpolicyを戻したりしない。
- 未認可で新解除を伴わない設定保存は可能。OSの空planは適用せず、観測を不明として保存する。

OS操作中のtimezone/認可等の観測も保持し、結果TX失敗後は現在policyに由来するnegative factsを独立TXへ再保存する。観測表の更新をさらに分け、そこだけの故障でgrant失効を戻さない。古いcontextは観測時に存在したgrantへ限定し、後発grantへ適用しない。候補だけの変更はreplayせず、rollback後の有効policyを正本にする。control DB自体が書けない場合はUncertainのまま復旧が必要であり、全保存成功を保証しない。

callback/停止/不整合復旧は#85。親#47は全子の検証まで閉じない。実OSの予定成立は#50、実解除/再制限は#52で確認する。

## 最新状態の再評価・中断復旧

[#90](https://github.com/kzk-maeda/itoma/issues/90)の`handleDeadlineCallback`は登録ID/世代が一致するときだけ最初の発火時刻を保存し、消費された保護に由来するActive→Uncertainも同じTXへ含める。観測表の更新は別に試み、その故障で発火事実を戻さない。既にobsoleteの予定はその状態を保つ。通知に旧planを持たせず、未知・旧・重複通知も`reconcile`で現在policy/Activation/grantを評価する。未有効化候補の予定が先に発火しても、現在の旧有効receiptとgrantの期限を変更しない。

`reconcile`は新しい解除用予定を登録せず、失敗commandを自動再送しない。Activeには元の解除commandのSucceededと、現在期限に一致するRegistered/未発火receiptが必要。有効化済み候補のreceiptは、希望policyがcommit済みなら候補commandのOS失敗とは分けて使う。保護を確認できないActiveは解除根拠から除き、現在のplanを反映する。再制限の失敗はUncertainで、予定を先に消さない。

Applying markerを独立commitし、最終writerでmarker/現在policy/Activationを確認してから同期操作する。OS操作中の期限・zone・時計変化には最新baselineを1回だけ試み、さらに変化すればUncertain。結果commitに失敗したらApplyingと保護予定を残し、観測済み失効だけを現在policyで独立保存する。成功した最新store反映とcommitの後に終了grantをReconciledへ整理し、lock外で不要予定を取消す。取消不明は次回の成功した再評価で再整理できる。

`reconcile(recoverInterruptedCommands: true)`は本体の起動等、native lifecycleで中断を回収する入口専用。同じserviceが実行中のcommandは除外し、残ったScheduling/ApplyingをUncertainへ進める。別processが生きているかはactorでは判定できないため、通常のcallbackではこのフラグを使わない。元grantの期限・上限と明示再試行を保持し、復旧で新しい解除を付与しない。ストレージ読取APIの追加だけでschema5は変更しない。

登録await中に終了したgrantの予定は、取消開始時にreceipt/発火事実が無ければ取消APIが成功してもUnknownとして追跡する。取消の後に登録が受理される可能性があるためで、後着receiptを保存してもRegisteredへ戻さない。新規grant/候補の両方がこの経路を通り、次の成功した再評価で再取消する。receiptを得られないまま中断した予定は、取消を最終確認できたと推測せず追跡を残す。

確定Rejectedは登録終了の否定事実として保存し、終了grantの当該予定を追加取消なしにobsoleteへ整理できる。取消待機中の後着Rejectedも取りこぼさない。取消前後は成功plan時のActivation/policy、観測ID、zone、時刻の上下限を照合し、現在状態が変わればRequiresRecoveryとする。別controllerの新しい観測は上書きせず、自分の古い観測だけをUncertainへ落とす。

認可不明/取消時はenabled/確認待ちから空のstore適用を行わない。確定Deniedを保存し、Approvedに戻っても本人の再開確認待ちを維持する。既に保存された本人のpaused意図は、自分のstoreを停止する根拠として扱う。停止/明示再開commandの受理は[#91](https://github.com/kzk-maeda/itoma/issues/91)へ分ける。Linuxのfake callbackは、Appleの通知配信・iPhoneのkill/再起動・制限成功を検証しない。

## 本人の停止・明示再開

[#91](https://github.com/kzk-maeda/itoma/issues/91)の`stop`/`resume`は本人操作ごとのcommandIDを受け取り、immutable intentと最新`activationCommandID`を先にcommitする。停止ではpausedと全grant失効、再開ではfresh Approvedと本人操作を確認してenabledを保存する。再開で旧grantを復活させない。重複IDは現在snapshotと元commandの結果を参照し、過去の停止/再開意図を再適用しない。

受理済みPendingを`executeAcceptedActivation`で進め、Applying commandと観測を同TXでcommitする。最終writerでは最新の本人操作ID・attempt/command・Applying marker・現在のActivationを照合し、Reconcilerが最新policyを同期反映する。command結果と観測は一緒にcommitする。新しい本人操作に置換された古いcommandはSupersededとなり、新しい意図のstoreを操作しない。

失敗や中断でもpaused意図を戻さず、保護予定を先に消さない。`retryActivation`は本人の明示再試行で、新attemptとfresh Approved（再開のみ）を確認して最新設定を反映する。古いcommandの再試行が新しい本人操作を上書きすることはない。起動時のReconcilerは希望状態の回復と中断commandのUncertain化を行うが、commandの成功や新しい解除を捏造しない。

control schema6へは本体だけが明示移行する。schema1〜5の設定/Activation/観測/履歴は保持し、本人操作IDはnilにする。private history schema2は不変。native adapter・build/署名・App Groups/Screen Time実機ゲートは引き続き別で、Swift/fake成功は実OSの停止・再開成功の証拠ではない。
