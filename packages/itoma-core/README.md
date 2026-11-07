# ItomaCore

本体SwiftとExtensionで共有するための、UI・Expo・SQLite・Screen Timeに依存しないSwift Package。外部パッケージ依存はなく、Foundationと標準ライブラリだけを使う。現在の範囲は[#42](https://github.com/kzk-maeda/itoma/issues/42)の**値型と構造的な入力検証**。

設計の根拠は[状態モデル](../../docs/system/domain-model.md)、[ルール](../../docs/system/rules.md)、[責務](../../docs/system/architecture.md)、[保存](../../docs/system/data.md)、ADR 0003〜0006（採用PR #36 / `6c17ac9`）。

## 実行する

Swift toolsの最低バージョンは6.0。CIの検証toolchainは公式DockerイメージのSwift 6.2.3 / Ubuntu 22.04で、イメージをdigestまで固定する。

Swiftを利用できる環境:

```sh
swift test --package-path packages/itoma-core --jobs 2
```

Dockerを利用できる環境では、repoルートからCIと同じ条件で実行できる。最初の実行時はイメージ取得の通信が必要。テストコンテナの通信は無効にし、ソースは読み取り専用、生成物はコンテナ内の一時領域へ置く。

```sh
docker run --rm --network none \
  --mount "type=bind,src=$PWD/packages/itoma-core,dst=/package,readonly" \
  swift:6.2.3-jammy@sha256:33c73fc133767cdaafde26f0f9967c96ab25ff77618b7df1eabf46140bf2b6e6 \
  swift test --package-path /package \
    --scratch-path /tmp/itoma-core-build --cache-path /tmp/itoma-swift-cache --jobs 2
```

managed cloudでは、runtimeのDocker手順に従って使用するdaemonを明示する。このrepoにセッション固有のproxy・CA・認証設定は保存しない。

テストにはtoolchain付属のSwift Testingを使う。`swift test`のXCTest欄が0件でも、その後のSwift Testingの実行結果を確認する。既存のGitHub `CI / quality`内で同じコマンドを実行し、Swift失敗時は後続のJS検証へ進まない。

## 型の境界

| 型 | 役割 |
| --- | --- |
| `EntityID<Kind>`と各ID alias | ランダムUUIDを受け取る、不透明で用途の違う識別子。IDを別用途へそのまま渡せない。アプリ名・bundle ID・native tokenは受け取らない |
| `PolicyRevision` / `RuleVersion` / `SnapshotSequence`等 | 用途を分けた非負Int64。0を基準値として表せ、次版のオーバーフローはエラー |
| `Instant` / `TimeZoneID` / `LocalDate` | 絶対UTC時刻、明示的なtimezone、開始日の暦日。現在時刻・端末timezoneを内部で取得しない |
| `WeeklySchedule` / `Rule` / `Selection` | 開始日基準の週次区間と不透明な選択参照。native tokenの正規化はadapterの責務 |
| `PolicySnapshot` / `PolicyCandidate` | 有効policyと未反映候補を別の型にする。候補はbase+1を予約するだけで、現在のpolicyを有効化/更新しない |
| `Command` | 本人操作のID・kind・状態・版・attempt・immutableな理由参照。本文や本文hashを持たない |
| `TemporaryGrant` / `OccurrenceKey` | 単一対象とrule/version/開始日/timezone/解決済み開始instantへの束縛。初期上限と実効期限を分離 |
| `DeadlineRegistration` / `DeadlineReceipt` | Preparing/Registered/Fired等と、受理の記録・世代・期限。別のID/世代/期限のreceiptを流用できない |
| `EvaluationContext` / `Evaluation` / 各Observation | 明示的に渡した時刻/認可/Activation、希望状態、証拠付きの観測を分ける |

`DeadlineReceipt`はadapterが記録する受理の事実であり、OSから発行される署名付きobjectではない。structを作れたことはOS APIを呼んだ証明にならない。`ApplicationObservation.applied`も自分のstoreの操作/観測に限り、システム全体の実効制限を保証しない。

## 入力と復元

- 空の曜日、不正な分値、0分/24時間超の区間、不正な解除時間を拒否する。開始=終了は、翌日終了を明示した24時間だけ許す。
- policyの重複rule ID、優先順の欠損/重複/未知ID、未対応schemaVersionを拒否し、順序や空設定へ自動修復しない。
- 候補版はbase+1。grant要求はpolicy版を進めない。`acceptedAt < effectiveExpiresAt <= initialExpiresAt`を要求する。
- Registeredには一致するreceiptと未発火、Firedには発火時刻が必要。古いcallbackを示すObsolete＋firedAtや、receipt保存前に発火した記録は保持できる。
- Appliedの観測には対象evaluation IDと証拠が必要。記録のない成功を表現しない。
- 不正timezoneを端末のtimezoneへ置換しない。観測済みの古い日時やclock変更の事実を消さないため、観測の鮮度は別途評価する。

`PolicySnapshot`のCodable形式はschemaVersion 1。IDはUUID文字列、counterはInt64、`Instant`単体のCodableはUnix秒の数値。復元も同じ検証を通す。集合のencoding順序はcanonicalではなく、bytesをID同一性やpayload digestへ流用しない。

この形式をSQLiteのschemaやTS bridgeのwire形式として自動採用しない。特にInt64をJSのnumberへ無条件に渡すと精度を失うため、bridgeで文字列等へ明示変換する。DBの版管理/移行・command/grant/receiptの行mapping・payload照合は#45/#47、bridge DTOは#9で扱う。

## 検証していないこと

型を作れることと、その操作を今実行してよいことは別。勝者/次境界/DSTの評価は#43、grantの発行・単調短縮・再試行・失効は#44、保存/重複排他は#45、予定登録→解除の実行順序と障害注入は#47で実装する。structを再構築しただけで、同じgrantの延長防止や登録成功を保証しない。

iOS向けのリンク、Expo Module・本体/Extensionへの組込みは#9/#14。対応iOS範囲、実機のOS API/期限精度は#8/#26で確認する。このLinuxでのコンパイル・単体テストを、SimulatorビルドやiPhoneのScreen Time動作の代わりにしない。
