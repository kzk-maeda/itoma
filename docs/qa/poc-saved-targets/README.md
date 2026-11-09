# 保存対象の表示・確認後の再制限

関連: [#119](https://github.com/kzk-maeda/itoma/issues/119)。確認日: 2026-11-09 JST。

## 対象と構成

- コード/JS/nativeのビルド対象: `3dfa7fea55d04218438d63949c7b84e3243d4297`。以後の証跡追記はdocsのみ。
- SRE05 / iPad第9世代 / iPadOS27.2。既存のiPhone向け構成による互換表示で確認し、iPad専用UIの受入とはしない。
- Release / iphoneos arm64 / 開発用自動署名 / PoC opt-in / native smoke=0。
- build ID: `2dc03893-6516-414f-9fa6-6e844c07d67a`。
- JS bundle SHA-256: `67246860d8a96aaf851a369b55a489d2c7b04fc826acdff944dedeafc279ba40`。
- ローカルapp.json構成SHA-256: `22d1dd1aa3823df5e30c53215aa9d7df8f9a44608df5547ac1be485964c9886f`。
- 本人承認の別Bundle ID `com.kzk-maeda.itoma.poc` とTeamはローカル設定だけ。commitへ含めず、Team/端末識別子、raw profile/log、実アプリ名・tokenをこの記録へ載せない。

## 自動チェック・CLI確認

- PASS: TypeScript、lint、Jest（7suite/56件）、demo、iOS tools、expo-doctor。
- PASS: Swift/native viewを含む新しい実機用ビルド、署名検証、profile/実entitlementのTeam・Bundle ID・Family Controls・development・SRE05一致。
- PASS: データを消去せずSRE05へ更新installし、OS起動・プロセス動作をCLIで確認。
- Swift packagesは未変更のため、package単体テストは今回ローカルで再実行していない。native lifecycle/OS APIの全分岐をJestやコンパイルが検証した意味ではない。

## 本人による実機観測

新しいbuild更新後、本人に「保存行のアプリ名・アイコン確認→保存した対象を確認して制限→native Pickerで対象確認→制限を開始→実アプリで制限確認→検証用制限停止」を依頼し、**「実機確認OK」**と回答を得た。

- アプリ名/アイコンの表示: PASS（本人報告）。
- 保存した対象の確認後の再制限: PASS（本人報告）。
- 対象アプリの制限・停止後の解除: PASS（本人報告）。
- 単回の案内手順に対する本人確認。agentが画面を直接観測した証跡ではなく、旧buildやiPhoneの結果から転用したものでもない。停止までの報告として試験用制限は解除済みと記録。

## UI・プライバシー

対象表示はAppleのLabelをnative内だけで描画し、RN propsはSelectionRef、eventは高さだけ。認可/停止後の再読込で表示を更新し、nativeのDynamic Typeの高さを数値で反映する。既存のGraphiteColors/Spacingとminimum48ptの操作を再利用。UI21/22/23/24/25/26、DESIGN原則1/3/4/5の限定範囲。

実際の選択アプリ名を含む画像は取得・公開しない。SimulatorはOS操作を無効化しており、保存された実対象のLabel/Picker/Shieldの成功証明には使わない。Simulatorの画像・構成は後述の限定範囲で別に記録する。

## 未検証・残件

- 新しい確認Pickerの取消を実機で個別に観測すること（JS経路のテストは成功）。
- 認可取消/再許可を観測した後、古い初期選択を使わず、新しいPicker選択が必要なこと。
- プロセス停止中の取消→再許可と無効tokenのOS上の処理。完全検知/有効性保証はしない。名前が出ない/対象が違う場合は新規選択へ戻る。
- VoiceOver、最大文字拡大、長い実アプリ名、往復100回、3回反復、iPad本体再起動/オフライン/File Protection/DB故障fixtureの全行列。
- 製品の予定/Extension/期限後再制限や全PoCの採否を、この部分成功だけで確定しない。

詳細metadata: [result.json](result.json)。[限定PoC提案](../../system/poc-saved-targets.md)を参照。

## Simulatorの表示確認

- iPad第9世代 / iOS27.2 / 現行iPhone向け構成の互換ウィンドウ / Light。
- build/install/launch/初期画面到達: PASS。署名なし、native smoke=0。
- 対象source: `3dfa7fea55d04218438d63949c7b84e3243d4297`、build ID: `52080afe-4822-4708-9ac3-0216333a04bb`。
- JS bundle SHA-256: `afc47bf70bef94bff2a3abac8875af84d8de251b156f0e9f2f6bcd968d280da3`。
- `devicectl device process launch --payload-url`で自作Simulatorの検証画面へ直接起動し、URL確認ダイアログがないこと、初期の説明・Simulator利用不可・保存未作成の表示を画像で確認。
- 実アプリ名/保存データは含まない。画像は初期画面の表示だけであり、保存行のApple Labelや実機Shieldの成功証明にしない。保存対象の表示・再制限・停止は上記の本人確認として別に記録。

![iPad Simulator・初期PoC画面・Light・実データなし](native-poc-light.png)
