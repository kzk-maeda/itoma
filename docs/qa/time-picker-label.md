# 時刻wheelのラベル折り返し（#149 / PR #151）

2026-11-12 JST本人のUIフィードバック。`fbae767d`ではDatePickerへ渡した「開始時刻」「終了時刻」をSwiftUIがホイールの隣に可視表示し、狭い幅で縦に折り返していた。Modalには既に「開始時刻を選ぶ」等の見出しがあるため、同じ文脈を重ねず時分の選択へ幅を渡す。

既存Expo UI 58.0.27の[labelsHidden](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/modifiers/#labelshidden)をDatePickerへ適用し、wheel内の可視ラベルを隠す。titleと明示的なaccessibilityLabelは開始/終了のまま保持する。上部見出し、24時間表示、UTCを時分の入れ物として使う変換、値の確定/取消、日付またぎ、保存は変更しない。DESIGN原則3/4、U07、UI22/UI24/UI35に対応。

JSの表示modifierのみの変更。追加依存・Swift/native module・entitlement/config変更はない。PASS: 型/Lint/Jest24 suites・163件/demo20件/expo-doctor20/20/diff check。実装を写すスタイル用テストは追加しない。対象SHAと結果はPRへ記録する。

[前段のWeb画像/操作証拠](time-picker/README.md)は`fbae767d`時点の時分select代替であり、SwiftUIのラベル折り返しを再現・検証できない。先行iOS build43146718809-1も今回のJS表示の検証にはstale native buildとして区別する。実機/Simulatorの変更後画像とVoiceOverは未確認。本人の後日の#118/#131 QAで、開始/終了の両方、狭幅/文字拡大、見出しと読み上げ名を確認する。
