# ITOMA local Expo bridge

ローカルSwift packageと本体を接続するiOSのtyped Expo Module。#94のCore検証port、明示的な手動PoC、#127の通常製品port、#132のprivate履歴portを区別する。ビルド/bridgeの存在と実機のOS成功は別である。

| port | version / 責務 |
| --- | --- |
| itomaNative | apiVersion1。Core duration検証とQA marker。getAvailabilityのosRestrictions=unconnectedはこの旧検証portの範囲で、製品全体の状態ではない |
| screenTimePoC | screenTimePoCUIVersion2。明示手動PoCの認可/Picker/own-store |
| screenTime | screenTimeVersion1。通常ルール/理由grant/停止・再開/評価済みsnapshot。OS adapterはSwift。実機成立は #131 |
| historyRecords | historyVersion1。最大40件のprivate履歴metadata、選択理由の詳細、明示取込/削除/容量・欠損。新binaryが必要。本文は一覧/URL/log/eventへ渡さない |

[#105](https://github.com/kzk-maeda/itoma/issues/105)で、製品APIから分離した`screenTimePoC`を追加。`/native-poc`から本人の明示操作で認可/Picker、app-privateの検証用ControlRepository、専用ManagedSettings storeへ接続する。Simulatorでは実操作を無効化する。設定/署名条件と旧PoCの実機手順は[限定実機PoC](../../docs/ios-device-poc.md)、通常製品は[runtime](../../docs/system/screen-time-runtime.md)、履歴は[保存・API契約](../../docs/system/history-records.md)を参照。旧binaryを新APIの検証には使用しない。

`screenTimePoC`のwire型はJSON文字列。MainActor内で表示用snapshotをserializeし、SendableなStringだけをExpoの`Promise.resolve(sending:)`へ渡す。TS clientでparse後に全fieldを検証する。Module自体や`[String: Any]`をactor境界へ渡さず、Swift6の競合検査を無効化しない。送信内容はopaque ref/件数/固定状態だけで、token/nameを含めない。

`itomaNative.getAvailability()`は未対応platform、モジュール欠落（Expo Go等）、API不一致、nativeエラーを区別する。availableはAPI v1のブリッジが存在する意味だけで、`osRestrictions: 'unconnected'`を返す。`validateDuration`はSwift Coreへ入力を渡し、TSは返却shapeと同一入力への対応だけを確認する。TSに許可範囲や制限ルールを複製しない。

Swiftの`validateDuration`は`UnlockDuration`を使う副作用のない呼出し。DB、予定、OS storeや認可を操作しない。main-app ModuleはCore/Storage/Control/Historyをimportするが、ItomaControl/ItomaStorageのpodspecはprivate Historyへ依存しない。Monitor Extensionは共有productだけを参照する。

各Swift packageと同じ`Sources/`をlocal podspecでコンパイルする。`expo-build-properties`の`ios.extraPods`にlocal pathを指定し、ItomaSQLiteはApple SDK標準の`SQLite3` moduleとsystem sqlite3を使う。LinuxのSwiftPM検証は既存の`CSQLite` system-library shimへfallbackする。SwiftPMソースのコピー・生成`ios/`の手編集は行わない。podspecの0.1.0はlocal metadataで、registry/tagへの公開ではない。既存dynamic app configとdemoの分岐は維持する。

SDK58の根拠:

- [versioned SDK資料](https://github.com/expo/expo/tree/sdk-58/docs/pages/versions/v58.0.0)
- [local Module](https://github.com/expo/expo/blob/sdk-58/docs/pages/modules/get-started.mdx)、[Modules API](https://github.com/expo/expo/blob/sdk-58/docs/pages/modules/module-api.mdx)、[CNG](https://github.com/expo/expo/blob/sdk-58/docs/pages/workflow/continuous-native-generation.mdx)
- [extraPodsの型](https://github.com/expo/expo/blob/sdk-58/packages/expo-build-properties/src/pluginConfig.ts)

公式サイトはこのcloud runtimeで403が継続しているため、公式リポジトリの対応版を参照した。Expo CLIでSDK58互換のbuild-propertiesを導入した。CLIはdynamic configを書換えないため、既存app.jsonへpluginを追加して`expo config`とautolinkingで検証する。

検証手順は[iOS QA](../../docs/ios-qa.md)。CI専用JSフラグとnative起動フラグの両方があるときだけ、synthetic commit/booleanのsmoke結果をstdoutへ出す。理由・token・ユーザー設定を読まず、通常起動のUI・操作・保存は変えない。APIの成功を実機のOS制限成功と表示しない。

## 保存対象のnative表示と再確認（#119）

`screenTimePoCUIVersion=2`ではSavedApplicationsViewがAppleのLabelを描画し、JSへはSelectionRefと高さだけを渡す。`review-and-apply`は保存対象を初期表示したnative Pickerで本人が「制限を開始」を押してから保存/適用する。認可変更を観測した場合は初期選択を空にし、新規選択が必要。プロセス停止中の取消の完全検知や旧tokenの有効性は保証しない。[PoC提案](../../docs/system/poc-saved-targets.md)を参照。Swiftと新native viewを含むビルドが必須で、古いバイナリを検証に使わない。
