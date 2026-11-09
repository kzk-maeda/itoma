# ItomaHistory（本体private保存）

[#79](https://github.com/kzk-maeda/itoma/issues/79) / 親[#46](https://github.com/kzk-maeda/itoma/issues/46)。PR #36 / ADR 0006の理由本文を本体private DBへ保存する部分。`ItomaHistory`は本体だけがimportするproductであり、Extensionが使う`ItomaStorage`は依存しない。両者はSQL接続/bind/短いtransactionだけを扱う技術target `ItomaSQLite`を利用する。CoreにSQLite依存はない。

## 契約

- `create`は本人/初期化controllerが明示的に新規作成するときだけ使う。O_EXCL/0600、WAL/FULL、schema3、application ID `0x49544849`。`open`は既存DBだけを検証し、空/破損/未対応schema/保護で読めないDBを初期化しない。各transactionでschema/app IDを再確認する。schema1/2からの`migrate`は本体が明示し、理由/tombstoneを保持して履歴表/検索索引を単一writer TXで追加する。
- `prepareReason`は本人が確定した理由の非空白判定後、原文UTF8をBLOBとして保存する。前後空白・Unicode・NULを切詰めない。同commandID/reasonRefと同一UTF8の再送は最初の時刻を返し、別本文/identityの使い回しを拒否する。本文hashを保存しない。
- IDはcanonical UUID表記を復元時に検証し、NOCASE UNIQUEと同じ照合のlookupで大小文字違いの論理重複/削除迂回を拒否する。`reason`はindexで検索し、`reasons`は最大500件のUUIDページ。容量集計のたびに全本文をSwiftへ読み込まない。
- `ReasonRecord`のPreparedはprivate commitの事実だけ。共有command受理・予定登録・OS成功を意味しない。Draft/確定前取消の本文を渡すAPIは設けない。入力画面がこの境界を守る必要がある。
- `HistoryCapacityPolicy`の論理payload閾値を呼出側から指定する。80/100MiB等の実測前候補を既定値にしない。`capacity`は理由のUTF8 bytes、確定ダミー選択/履歴recordのencoded bytesを合算し、`fileUsage`はDB/WAL/SHMの実ファイルサイズを別に観測する。metadata/SQLiteページ分を含む端末使用量上限ではない。
- 上限超過は`capacityExceeded`。過去本文の自動切詰め/期間削除をしない。同じ確定操作の再送は追加保存ではないため、閾値が下がっていても既存結果を返す。理由保存に失敗したら、controllerは理由必須解除へ進めない。
- `deleteReasons`は本文をNULL/論理payloadを0にし、commandID/reasonRef/元時刻のtombstoneを保持する。同じidentityの再送は`deleted`となり復活しない。制限設定には触れない。SQLiteページ/WAL/バックアップからの法科学的消去は保証しない。
- 同期・非SendableのRepositoryで、公開callbackからwriterを保持できない。private/sharedの2DBを同じtransactionやwrite lockの下で扱わない。

## 履歴の受渡しと削除

[#80](https://github.com/kzk-maeda/itoma/issues/80)で共有outbox、private履歴、eventID重複排除、delete cutoff、Preparedとの照合を接続する。

- `acceptReasonGrant`はprivate Prepared commitを閉じてから共有intentを受理する。private失敗なら共有command/grantを作らず、共有失敗ならPreparedだけが残る。`reconcileReason`は未受理/削除済み/共有状態を区別し、解除成功を推測しない。
- `ControlRepository.transferHistory`は共有read TXを閉じ、`commitHistoryBatch`のprivate commitが成功した後に共有ack TXを開始する。private commit後/ack前で中断してもeventID/source/sequenceを照合し、履歴は1件。ackは一致したbatchだけのoutbox payloadを削除し、ID/sequenceだけの小さい台帳を残す。
- private失敗はackせず、controlに`historyIncomplete`を記録する。controlへ欠損すら記録できない場合は保存エラーを返し、成功にはしない。履歴全体の完全性を保証せず、欠損フラグは保守的に維持する。
- `deleteHistory(from:)`は共有DBごとのsourceID/高水位をlock外で取得し、private TXでcutoffとpayload削除をcommitする。古い未ack batchはpayloadを復活させずack可能。現在sourceで取得した境界より新しい履歴eventは保持し、作り直したcontrolの新source/sequence1には古いcutoffを適用しない。理由とダミー本文は削除TX時点で除去し、identity tombstoneを維持する。
- `prepareDummySelection`は確定した整数minor units/3文字通貨codeを保存する技術契約だけ。金額候補/既定通貨のUI決定や決済APIを追加しない。未確定選択を拒否し、取消eventはIDと時刻だけを持ち、本文/choiceを渡せない。
- `history`はprivateの増加cursorによる最大500件のページ。共有eventは操作台帳のsnapshotであり、OS全体の実効状態/利用時間を測定した記録ではない。

## 後続境界

#132で40件の日時keyset/日付範囲/private revisionと、本文を持たない理由metadataを追加。日付索引はkind/ID/時刻だけを持ち、本文を複製しない。全件検証/移行は100件ずつ処理する。通常画面の契約は [history-records.md](../../docs/system/history-records.md)。固定累計/週月集計の記録方式は #96〜#100 の別ゲート。

実際のCommandServiceが予定登録/OS結果と同じ短いTXでoutboxへ記録する接続は#47、UI/最低限の削除操作は#57。モックI/OやこのRepositoryだけで解除・再制限の成立を宣言しない。

本体privateのcontainer選択・File Protection・DB/WAL/SHMのbackup除外と端末ロック中の動作は[#49](https://github.com/kzk-maeda/itoma/issues/49)。このportable Repositoryへ任意のURLを渡せることは、iOS上の保存先/保護を確認した証拠ではない。

## 検証

[READMEの固定Docker command](README.md#検証する)はcontrol、history、技術層の各test targetを一緒に実行する。一時SQLiteでPrepared再open、原文UTF8/NUL、空白、同ID/別payload、容量、削除後再送、writer競合/insert失敗、破損/別DB/未対応版を検証する。Core/Storageの既存テストも維持する。UI/Expo/OS Adapter・iOSリンク・Simulator・iPhone・実プロセスkillの証拠とは分ける。
