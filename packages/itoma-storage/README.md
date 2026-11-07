# ItomaStorage

ItomaCoreの外側で、iOS標準のSQLite C APIを包む薄いSwift Package。UI・Expo・Screen Timeには依存せず、理由本文の保存先でもない。#45を[#69](https://github.com/kzk-maeda/itoma/issues/69) snapshot、[#70](https://github.com/kzk-maeda/itoma/issues/70) command/候補、[#71](https://github.com/kzk-maeda/itoma/issues/71) grant/receiptへ分割し、この段階はsnapshotまでを扱う。

## 保存の契約

- `ControlRepository.create`は本人/初期化controllerが明示的に新規作成するときだけ使う。O_EXCLで新しいファイルを取得し、SQLiteはCREATEなしで開く。既存・空・破損・保護で読めないDBを初期化しない。途中で作成に失敗したファイルも自動消去しない。
- `open`は既存DB専用。schemaVersion 1、application_id `0x49544F4D`、quick_check、WALと論理snapshotを検証。各TX内でもschema/app IDを再確認し、別接続で移行された後の古い接続は読み書きしない。未対応版をdown-migrateしない。初版に移行元schemaはなく、今後の移行は本体所有のwriter TXと別の検証を必要とする。
- 有効policyとlast-valid policyは独立BLOB、policyRevision/snapshotSequence/Activationは明示列。不透明Selectionはref・正規化済みtargetRef集合・token用opaque bytesとして別表に保存する。policy復元はCoreの検証済みdecoderを通し、列のrevisionとも一致させる。他のCore値をDB形式へ自動採用しない。
- `readSnapshot`は短いread TX。`setActivation`/`putSelection`はBEGIN IMMEDIATEの短いwriter TXでsnapshotSequenceをCASし、変更時に進める。policyRevision/ruleVersionは進めない。各接続内も同期排他し、クラスはSendableにしない。OS操作・awaitをTXへ持ち込むAPIは公開しない。
- Selectionのrefは不変。新しい対象選択は新refを準備し、後続の候補policyとruleVersion更新で有効化する。参照先を先に書き換えて現在のruleを変えない。targetRefはadapterがnative tokenの同一性で正規化し、名前/encoded bytes/hashで生成しない。
- SQLiteエラーはbusy/corrupt/unavailable等の固定分類だけ。SQL・ファイルパス・token・理由本文をエラーへ含めない。失敗はrollbackし、空設定の成功へ置換しない。WALはwriterの同時成功を意味しない。

この段階のActivationは保存した本人の意図であり、OS反映や再制限成功ではない。command/候補とgrantを伴う有効化は#70/#71/#47で接続する。last-valid policyもDB全体の破損復旧を保証せず、自動復旧や古いgrantの復活に使わない。

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
