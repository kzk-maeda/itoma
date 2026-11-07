# ItomaStorage

ItomaCoreの外側で、iOS標準のSQLite C APIを包む薄いSwift Package。UI・Expo・Screen Timeには依存せず、理由本文の保存先でもない。#45を[#69](https://github.com/kzk-maeda/itoma/issues/69) snapshot、[#70](https://github.com/kzk-maeda/itoma/issues/70) command/候補、[#71](https://github.com/kzk-maeda/itoma/issues/71) grant/receiptへ分割し、この段階はsnapshotとcommand/候補までを扱う。

## 保存の契約

- `ControlRepository.create`は本人/初期化controllerが明示的に新規作成するときだけ使う。O_EXCLで新しいファイルを取得し、SQLiteはCREATEなしで開く。既存・空・破損・保護で読めないDBを初期化しない。途中で作成に失敗したファイルも自動消去しない。
- `open`は既存DB専用。schemaVersion 2、application_id `0x49544F4D`、quick_check、WALと論理snapshotを検証。各TX内でもschema/app IDを再確認し、別接続で移行された後の古い接続は読み書きしない。未対応版をdown-migrateしない。schema1からは本体が明示的に`migrate`を呼び、writer TXでcommand表を追加してから版を進める。Extensionのopenは自動移行しない。移行失敗時はDDL/版ともrollbackし、設定を消さない。
- 有効policyとlast-valid policyは独立BLOB、policyRevision/snapshotSequence/Activationは明示列。不透明Selectionはref・正規化済みtargetRef集合・token用opaque bytesとして別表に保存する。policy復元はCoreの検証済みdecoderを通し、列のrevisionとも一致させる。他のCore値をDB形式へ自動採用しない。
- `readSnapshot`は短いread TX。`setActivation`/`putSelection`はBEGIN IMMEDIATEの短いwriter TXでsnapshotSequenceをCASし、変更時に進める。policyRevision/ruleVersionは進めない。各接続内も同期排他し、クラスはSendableにしない。公開writer scopeは同期closureのみ。予定登録・認可要求・UI待機等のawaitは外で行い、#47での短い最終同期OS操作だけをTX内へ接続する。
- Selectionのrefは不変。新しい対象選択は新refを準備し、後続の候補policyとruleVersion更新で有効化する。参照先を先に書き換えて現在のruleを変えない。targetRefはadapterがnative tokenの同一性で正規化し、名前/encoded bytes/hashで生成しない。
- SQLiteエラーはbusy/corrupt/unavailable等の固定分類だけ。SQL・ファイルパス・token・理由本文をエラーへ含めない。失敗はrollbackし、空設定の成功へ置換しない。WALはwriterの同時成功を意味しない。

この段階のActivationは保存した本人の意図であり、OS反映や再制限成功ではない。grantを伴う有効化は#71/#47で接続する。last-valid policyもDB全体の破損復旧を保証せず、自動復旧や古いgrantの復活に使わない。

## commandと候補のtransaction

`repository.write { transaction in ... }`のscope内で、`acceptCandidate`、`recordCommand`、`activateCandidate`を呼ぶ。scope終了後のtransaction objectは無効。ネストはエラーにし、scope中のcloseも拒否する。各操作が失敗したらrollback-onlyとし、呼出側がエラーを捕捉して戻っても外側のcommitを拒否する。counterのoverflowや保存途中の失敗をsequence不変の部分commitにしない。

- 新しいcommandはPending/attempt0で受理。有効policy版とsnapshotSequenceを確認し、Core共通の`PolicyCandidate.validate`でruleVersionの使い回しも拒否。command/attemptとPending候補を一緒にcommitし、policyは有効化しない。
- 同IDはdecoded構造でimmutableなintentを照合し、一致すれば最新の同command結果を返す。JSONの集合/キー順や本文hashで同一性を決めない。異なるpayloadのID再利用はconflict。理由は参照だけを持つ。
- attempt更新は元commandの完全一致をCAS。Failed/Uncertainからの再実行は次attemptのPendingへ進める。各attemptの最終記録を保持し、同attemptのApplying再開で失敗結果を消さない。結果不明の観測を確定する更新と、再実行を分ける。
- Succeeded/Cancelled/Superseded/Expiredは再実行へ戻せない。候補データは取消/失敗後も保持し、Applyingのcommandだけが最終CASへ進める。
- `activateCandidate`は有効policyのbaseを再確認して、last-valid policy・新policy・版・sequenceを同じwriter TXで切り替える。失敗/割込みのrollback後も、先に受理した候補とcommandは残る。

`activateCandidate`は保存の最終CAS primitiveであり、本人確認・OS予定受理・期限再確認を証明しない。grant/receiptの保存チェックは#71、全ての実行前提とモックI/Oの順序は#47で組み合わせる。commandの保存/成功状態だけをOS成功の証拠にしない。

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
