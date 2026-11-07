# ItomaCore

本体SwiftとExtensionで共有するための、UI・Expo・SQLite・Screen Timeに依存しないSwift Package。外部パッケージ依存はなく、Foundationと標準ライブラリだけを使う。[#42](https://github.com/kzk-maeda/itoma/issues/42)の値型、[#43](https://github.com/kzk-maeda/itoma/issues/43)の週次ルール、[#44](https://github.com/kzk-maeda/itoma/issues/44)の一時解除・編集影響の純粋評価を扱う。

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

## 週次ルールを評価する

`RuleEvaluator.evaluate(policy:selections:context:through:)`へ、有効policy、native tokenを正規化した`Selection`、明示的な時刻/timezone/認可/Activation、検索終端のUTC instantを渡す。副作用や端末の現在値の取得はない。

| 結果 | 意味 |
| --- | --- |
| `occurrences` / `activeOccurrences` | 検索区間と交差する有効な現地時間帯と、nowを含む時間帯。終了は含まない |
| `targets[target].activeOccurrences` / `winner` | 対象ごとの優先順と現在の勝者。停止ルールを除外し、モードで並べ替えない |
| `targets[target].nextWinnerChange` | 勝者の完全なoccurrenceKeyが次に変わる時刻。下位ルールだけの境界は除外 |
| `desiredTargets` | grant適用前の設定上の制限対象。認可approvedかつActivation enabledのときだけ算出 |
| `nextBoundary` / `nextEvaluationAt` | 全ルールの次の境界と、境界がなくても必要な検索終端での再評価 |
| `overlaps` | 指定区間内の、別ルール間の共通対象・実際のUTC重複区間・優先順。本人確認や保存は呼出側 |
| `invalidOccurrences` | DST解決後に開始>=終了となった時間帯。通知用の事実を返し、24時間へ変換しない |

`through > now`、検索幅は最大366経過日。これは1回の検索の計算量の上限であり、週次設定の利用期間を制限しない。入力instantのUTC年は0002〜9998。範囲外、欠落した有効ルールのSelection、重複Selectionをエラーにし、空のplanへ修復しない。停止ルールのSelectionは不要。空の対象集合は有効。

`nextBoundary`と`nextWinnerChange`のnilは**evaluatedThrough以内に見つからない**という意味。呼出側は`nextEvaluationAt`までに再評価する。grant期限を求めるときは、要求する期限全体を検索範囲へ含めるか、検索終端でも上限を切る。編集確認にも検査したtimezoneと期間を示し、この結果だけで全ての将来の重複がないとは扱わない。

境界はtimezoneのオフセット候補と切替instantから解決する。不存在は次の有効instant、重複は開始を最早・終了を最遅とする。日付全体の欠落も同じ規則。通常の24時間は**現地暦の長さ**であり、DST日に経過23/25時間となることがある。同一ルールの連続した24時間occurrenceが重複した場合は、新しい解決済み開始を優先し、同一instantなら新しい開始日を優先する。前日分の終了で勝者が前日に戻ることはない。

`RuleEvaluation`はgrant適用前の中間結果で、最終`Evaluation`/OS適用記録とは別。認可不明時の空`desiredTargets`は、既存OS設定を削除してよい指示ではない。認可の鮮度、停止/再開の状態遷移、OS操作の可否はcontroller/adapter側で扱う。認可観測がapprovedでも再開承認待ちを自動解除しない。

## 一時解除と編集影響を評価する

| API | 出力と責務 |
| --- | --- |
| `UnlockCondition.reason` / `.dummyPayment` | 空白/改行だけの理由、選択取消を拒否。理由本文・金額・本文hashを値に保持しない。UIの本人確認の証拠ではない |
| `GrantEvaluator.propose` | 現在のpolicy版・勝者occurrence・認可・Activation・モードを照合し、`proposed`には**Pending**のgrantだけを返す。同commandまたは同対象に未終端grantがあれば元の記録を`existing`で返し、新期限を作らない |
| `GrantEvaluator.evaluate` | 現在の週次評価とgrantを照合。Activeかつ有効な単一対象だけをdesiredTargetsから除外。残時間、次境界、失効/時計不整合の記録、短縮が必要な提案を返す |
| `GrantEditEvaluator.preview` | 未有効化の候補policyについて、旧/新期限・理由・影響対象・残る制限の勝者/モード・確認要否・新予定が必要な短縮を返す。有効policyやgrantを更新しない |
| `GrantEditEvaluator.checkConfirmation` | 最終処理時に候補、base policy、snapshotSequence、選択、grant集合、認可/Activation/timezone、未来の影響を再照合。時計/sequence巻戻しや影響変更を拒否し、最新の評価を返す。sequenceだけが進み入力/影響が同じなら再確認を強制しない |
| `TemporaryGrant.shortened(to:)` | ID・occurrence・acceptedAt・initialExpiresAt・statusを保った値の変換。現在のeffectiveExpiresAtを超える延長は拒否。変換だけでは保存/予定登録/有効化されない |

新規の期限は`min(now + duration, 現occurrence終了, 次の勝者切替)`。duration省略時はpolicyの共通設定を使う。受理済みのinitialExpiresAtを固定し、既存grantには変更後のデフォルトを再適用しない。復元データも受理時から最大30分であることを検証する。週次検索はnowから30分を覆い、有効な全grant/要求の期限内の切替を確認する。

時計巻戻しでacceptedAtがnowより未来になった場合も、次の再評価をこの30分の検索終端より後へ送らない。遠いgrant期限だけを次境界とすると、検索期間外にある週次ルールの開始を飛ばしてしまうため、終端までの再評価を必須にする。

Pending/Scheduling/Applying/Uncertain/Failedは解除の根拠にしない。ReblockPendingも解除せず、未終端の対象を予約する。新IDで迂回せず、controllerが同grantの明示的な再試行か終端への整理を行う。重複grant ID/command ID、同対象の複数未終端grantはエラー。`existing`は過去の記録の応答であり、再適用の許可ではない。同commandの**厳密なpayload一致**、並列受理の排他、登録receiptと世代の照合は#45/#47のcommand側でも必須。

`GrantAssessment.grant`に返るExpired/Invalidated/Uncertainは、controllerが永続化して次の評価へ渡す論理記録。古い入力を破棄せず再利用すれば過去の失効を検出できない。terminalな記録は勝者/timezone/時計が戻っても解除へ復帰しない。nowがacceptedAtより前ならUncertainとし、時刻が進んでも自動でActiveに戻さない。プロセス停止中の全時計・認可変化の検出や時計改ざん耐性は保証しない。

未来の切替が早まった場合、`shorteningRequired`は旧grantを保持して新期限を**提案**するだけ。新しい確定済み残時間を返さず、未準備の短縮を持つgrantを解除根拠にしない。編集時はcurrent policyの評価を維持したまま`preview`を表示し、取消/予定準備失敗なら候補を有効化しない。別ルールへの切替、対象除外、ruleVersion/occurrence変更は失効の確認対象。候補がルール内容を変えてversionを進めていなければ拒否する。

短縮を採用するcontrollerは、本人確認→予定登録/receipt保存→最終TX内で確認内容・期限・世代の再検証→値の短縮/候補有効化を行う。`checkConfirmation`はこのうち純粋な照合だけで、本人の承認や登録成功を自動的に証明しない。予定登録・取消・失敗時のrollbackをこのPackageで実行しない。取消で旧値を保つことは検証しても、実際の予定APIの障害注入は#47以降。

テストのActive/観測等は合成した入力であり、OSに適用した記録ではない。R05/R07/R08/R11/R13/R14とD03〜D05/D07/D11/D12の純粋部分を検証し、DBでの同時受理やUI/OSを含む全体完了とは扱わない。

## 検証していないこと

型や提案を作れることと、その操作を今実行してよいことは別。保存/重複排他は#45、予定登録→解除の実行順序と障害注入は#47で実装する。structを再構築しただけで、保存された全履歴での延長防止や登録成功を保証しない。重複/編集影響を返すことは、保存時の本人確認UIを実装したことではない。

iOS向けのリンク、Expo Module・本体/Extensionへの組込みは#9/#14。対応iOS範囲、実機のOS API/期限精度は#8/#26で確認する。このLinuxでのコンパイル・単体テストを、SimulatorビルドやiPhoneのScreen Time動作の代わりにしない。
