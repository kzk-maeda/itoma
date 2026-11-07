# ItomaStorage

ItomaCoreの外側で、iOS標準のSQLite C APIを包む薄いSwift Package。UI・Expo・Screen Timeには依存せず、理由本文の保存先でもない。#45を[#69](https://github.com/kzk-maeda/itoma/issues/69) snapshot、[#70](https://github.com/kzk-maeda/itoma/issues/70) command/候補、[#71](https://github.com/kzk-maeda/itoma/issues/71) grant/receiptへ分割して実装する。

本Packageの公開productは、共有control用`ItomaStorage`と本体private用[`ItomaHistory`](HISTORY.md)に分かれる。Extensionは`ItomaStorage`だけに依存し、理由本文のAPIをリンクしない。共通の`ItomaSQLite` targetはSQLite接続/bind/transactionの技術層だけを提供する。controlのschema3・公開StorageErrorは変更しない。

## 保存の契約

- `ControlRepository.create`は本人/初期化controllerが明示的に新規作成するときだけ使う。O_EXCLで新しいファイルを取得し、SQLiteはCREATEなしで開く。既存・空・破損・保護で読めないDBを初期化しない。途中で作成に失敗したファイルも自動消去しない。
- `open`は既存DB専用。schemaVersion 3、application_id `0x49544F4D`、quick_check、WALと論理snapshotを検証。各TX内でもschema/app IDを再確認し、別接続で移行された後の古い接続は読み書きしない。未対応版をdown-migrateしない。schema1/2からは本体が明示的に`migrate`を呼び、writer TXでcommand/grant/registration表を追加してから版を進める。Extensionのopenは自動移行しない。移行失敗時はDDL/版ともrollbackし、設定を消さない。
- 有効policyとlast-valid policyは独立BLOB、policyRevision/snapshotSequence/Activationは明示列。不透明Selectionはref・正規化済みtargetRef集合・token用opaque bytesとして別表に保存する。policy復元はCoreの検証済みdecoderを通し、列のrevisionとも一致させる。他のCore値をDB形式へ自動採用しない。
- `readSnapshot`は短いread TX。`setActivation`/`putSelection`はBEGIN IMMEDIATEの短いwriter TXでsnapshotSequenceをCASし、変更時に進める。policyRevision/ruleVersionは進めない。各接続内も同期排他し、クラスはSendableにしない。公開writer scopeは同期closureのみ。予定登録・認可要求・UI待機等のawaitは外で行い、#47での短い最終同期OS操作だけをTX内へ接続する。
- Selectionのrefは不変。新しい対象選択は新refを準備し、後続の候補policyとruleVersion更新で有効化する。参照先を先に書き換えて現在のruleを変えない。targetRefはadapterがnative tokenの同一性で正規化し、名前/encoded bytes/hashで生成しない。
- SQLiteエラーはbusy/corrupt/unavailable等の固定分類だけ。SQL・ファイルパス・token・理由本文をエラーへ含めない。失敗はrollbackし、空設定の成功へ置換しない。WALはwriterの同時成功を意味しない。

この段階のActivationは保存した本人の意図であり、OS反映や再制限成功ではない。変更時には未終端grantも同じTXで失効させ、再開で昔の解除を戻さない。OS実行は#47以降で接続する。last-valid policyもDB全体の破損復旧を保証せず、自動復旧や古いgrantの復活に使わない。

## commandと候補のtransaction

`repository.write { transaction in ... }`のscope内で、`acceptCandidate`、`recordCommand`、`activateCandidate`を呼ぶ。scope終了後のtransaction objectは無効。ネストはエラーにし、scope中のcloseも拒否する。各操作が失敗したらrollback-onlyとし、呼出側がエラーを捕捉して戻っても外側のcommitを拒否する。counterのoverflowや保存途中の失敗をsequence不変の部分commitにしない。

- 新しいcommandはPending/attempt0で受理。有効policy版とsnapshotSequenceを確認し、Core共通の`PolicyCandidate.validate`でruleVersionの使い回しも拒否。command/attemptとPending候補を一緒にcommitし、policyは有効化しない。
- 同IDはdecoded構造でimmutableなintentを照合し、一致すれば最新の同command結果を返す。JSONの集合/キー順や本文hashで同一性を決めない。異なるpayloadのID再利用はconflict。理由は参照だけを持つ。
- attempt更新は元commandの完全一致をCAS。Failed/Uncertainからの再実行は次attemptのPendingへ進める。各attemptの最終記録を保持し、同attemptのApplying再開で失敗結果を消さない。結果不明の観測を確定する更新と、再実行を分ける。
- Succeeded/Cancelled/Superseded/Expiredは再実行へ戻せない。候補データは取消/失敗後も保持し、Applyingのcommandだけが最終CASへ進める。
- `activateCandidate`は有効policyのbaseを再確認して、last-valid policy・新policy・版・sequenceを同じwriter TXで切り替える。失敗/割込みのrollback後も、先に受理した候補とcommandは残る。

`activateCandidate`はCoreで影響を再計算し、必要な確認と全grantの変更を照合する。短縮には候補command・policy版・新期限へ束縛した最新のRegistered/未発火receiptが必要で、一部だけの成功ではpolicy/grantともcommitしない。候補の有効化記録も保持し、未有効化候補のreceiptを通常の解除へ使わない。全体のOS実行前提とモックI/Oの順序は#47で組み合わせ、保存/成功状態だけをOS成功の証拠にしない。

## grant・登録事実・耐障害境界

- `acceptGrant`はCoreへ現在policy/時刻/選択を渡し、Pending grantとcommandを同じTXで受理。Coreの`reservesTarget`からSQLの予約フラグを作り、UNIQUE partial indexでも1対象1未終端grantを保証する。読取時は予約フラグ・payload・owner intentの不一致を拒否する。
- 同対象の既存grantに合流した別commandも、Superseded結果と解決先grant参照を永続化する。同IDの遅延再送は元のgrant/期限を返し、終端後に新しい5分を作らない。新しい本人操作には新commandIDが必要。理由本文は持たず、reason modeにはprivate Prepared理由への参照を要求する（実際のPrepared保存は#46）。
- initialExpiresAt・acceptedAt・対象/occurrence・owner IDは不変。非終端grantの短縮は汎用`recordGrant`で行わず、候補確認＋登録照合を伴う原子的な変更へ限定する。Pending/Uncertainへstatusを落としても迂回できない。終端失効・即時再制限は新予定の失敗だけで妨げない。
- `StoredGrant.hasEnded`は一度立つと戻さない。失効後の再制限がUncertain/Failedになっても、同grantをApplying/Activeへ戻さない。Coreの論理grantと、過去の終端を維持する保存上の事実を分け、再制限確認中は対象の予約を維持する。Reconciledは変更せず、古いcallbackで処理を復活させない。
- registrationはPreparingを先にcommitし、API呼出しの外部事実を後のTXで保存する。receipt/firedAtの最初の追加はstatusに依存せず同じ未commitのPreparing scopeでは拒否。receiptを記録した同じTX内で最終適用/候補有効化することも拒否する。
- 登録ID・grant/command ID・policy/candidate版・世代・予定時刻は不変。世代は0から増やし、receipt/発火済みの事実を消さない。最新世代・Registered・未発火・一致する期限・現在時刻/Activation/勝者を確認してからApplying/Activeへ進める。古い世代への発火記録は保持できても、新しいgrant/期限を変更しない。

登録receiptはadapterが記録したAPI受理の事実であり、OSが発行する署名や配信保証ではない。writer scopeに実OSを呼ぶコードはなく、勝手な副作用をDBが取り消せるわけでもない。#47のcontrollerが、intent/Preparing commit→登録API（lock外）→receipt commit→最終再検証/短い同期OS操作/結果commitの順序を守る。テストのActive/receiptは合成データで、Screen Timeを動かした証拠にしない。

## 検証する

Swift 6.0以降とSQLite開発ヘッダーがある環境:

```sh
swift test --package-path packages/itoma-storage --jobs 2
```

CIはSwift 6.2.3のdigest固定イメージに公式Ubuntuの`libsqlite3-dev`を加え、core/storageの両Packageをテストする。SQLiteパッケージはセキュリティ更新に追随するため、Swiftイメージのdigest固定だけでOSライブラリ版まで固定したとは扱わない。今回のLinux検証はSQLite 3.37.2（Ubuntu package 3.37.2-2ubuntu0.8）。

repoルートからCIと同じテストを実行:

```sh
docker build -f .github/docker/swift-tests.Dockerfile -t itoma-swift-tests .github/docker
docker run --rm --network none \
  --mount "type=bind,src=$PWD/packages,dst=/packages,readonly" \
  itoma-swift-tests sh -c '
    swift test --package-path /packages/itoma-core --scratch-path /tmp/core-build --cache-path /tmp/swift-cache --jobs 2 &&
    swift test --package-path /packages/itoma-storage --scratch-path /tmp/storage-build --cache-path /tmp/swift-cache --jobs 2'
```

managed cloudのdaemon/proxy/CAはruntime手順に従う。必要ならビルドの`proxy_ca` secretへセッションの公開CAを渡す。セッション設定・CA・認証をrepoやimageへ保存しない。テスト自体は通信なし、ソースread-only、DB/生成物はコンテナ内の一時領域。

## 根拠と未検証

採用設計はPR #36 / ADR 0006、[data.md](../../docs/system/data.md)。実装前に[SQLite公式のC API仕様ソース](https://github.com/sqlite/sqlite/blob/master/src/sqlite.h.in)を確認（2026-11-07）。open flags、busy timeout、prepared statementのbind/lifetimeを確認し、導入したネイティブライブラリでコンパイル/実行する。

テストは一時DBで保存/再open、CAS、別接続のwriter競合、破損したpayload/欠落参照、未対応schema、別DB、空既存ファイル、閉じた接続を扱う。iOSリンク、App Groups、File Protection、WAL/SHMの保護/バックアップ除外、実プロセスkill/再起動は未検証。#49で本体/Extensionと実機の証跡を残す。失敗したDBを自動で消す復旧UIは追加しない。
