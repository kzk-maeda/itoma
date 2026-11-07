# ITOMA local Expo bridge

[#94](https://github.com/kzk-maeda/itoma/issues/94)のiOS限定PoC。JS/Swiftの型付き境界と共通SwiftのiOSビルドを検証する。Screen Time・永続設定・認可・OS制限は接続せず、ホームの制限操作は引き続きモック。

`itomaNative.getAvailability()`は未対応platform、モジュール欠落（Expo Go等）、API不一致、nativeエラーを区別する。availableはAPI v1のブリッジが存在する意味だけで、`osRestrictions: 'unconnected'`を返す。`validateDuration`はSwift Coreへ入力を渡し、TSは返却shapeと同一入力への対応だけを確認する。TSに許可範囲や制限ルールを複製しない。

Swiftの`validateDuration`は`UnlockDuration`を使う副作用のない呼出し。DB、予定、OS storeや認可を操作しない。main-app ModuleはCore/Storage/Control/Historyをimportするが、ItomaControl/ItomaStorageのpodspecはprivate Historyへ依存しない。将来のExtensionはshared productだけを参照する。

各Swift packageと同じ`Sources/`をlocal podspecでコンパイルする。`expo-build-properties`の`ios.extraPods`にlocal pathを指定し、CSQLiteだけをmodular headersとしてAppleのsystem sqlite3へリンクする。SwiftPMソースのコピー・生成`ios/`の手編集は行わない。podspecの0.1.0はlocal metadataで、registry/tagへの公開ではない。既存dynamic app configとdemoの分岐は維持する。

SDK58の根拠:

- [versioned SDK資料](https://github.com/expo/expo/tree/sdk-58/docs/pages/versions/v58.0.0)
- [local Module](https://github.com/expo/expo/blob/sdk-58/docs/pages/modules/get-started.mdx)、[Modules API](https://github.com/expo/expo/blob/sdk-58/docs/pages/modules/module-api.mdx)、[CNG](https://github.com/expo/expo/blob/sdk-58/docs/pages/workflow/continuous-native-generation.mdx)
- [extraPodsの型](https://github.com/expo/expo/blob/sdk-58/packages/expo-build-properties/src/pluginConfig.ts)

公式サイトはこのcloud runtimeで403が継続しているため、公式リポジトリの対応版を参照した。Expo CLIでSDK58互換のbuild-propertiesを導入した。CLIはdynamic configを書換えないため、既存app.jsonへpluginを追加して`expo config`とautolinkingで検証する。

検証手順は[iOS QA](../../docs/ios-qa.md)。CI専用JSフラグとnative起動フラグの両方があるときだけ、synthetic commit/booleanのsmoke結果をstdoutへ出す。理由・token・ユーザー設定を読まず、通常起動のUI・操作・保存は変えない。APIの成功を実機のOS制限成功と表示しない。
