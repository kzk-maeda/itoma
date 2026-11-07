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

候補編集/全grant短縮と旧予定取消は#84、callback/停止/不整合復旧は#85。親#47は全子の検証まで閉じない。実OSの予定成立は#50、実解除/再制限は#52で確認する。
