# 認可・選択・手動制限の実機PoC

対象: [#105](https://github.com/kzk-maeda/itoma/issues/105)、親[#12](https://github.com/kzk-maeda/itoma/issues/12)/[#13](https://github.com/kzk-maeda/itoma/issues/13)。**コード/署名不要Simulatorの限定PoC**であり、iPhoneでの合格や製品フロー完成を意味しない。

## 現在の前提

2026-11-08 JSTの利用者回答: **iPhone SE第3世代 / iOS27.0.1 / Xcode27.2**。実機操作と結果報告は利用者が担当する。Apple Developer未登録、利用できる既存Program Teamもない。この回答を再質問しない。最新の外部条件は[#8](https://github.com/kzk-maeda/itoma/issues/8)を正本とする。

現在のcloud環境はunrestricted/enforcedでApple/Expo公式資料へ接続可能。CLIのartifact実配信先CONNECT403は残るが、接続済みGitHubの正式取得APIでPR #95のZIPを取得し、実digest・JSON・画像を確認できた（[#102](https://github.com/kzk-maeda/itoma/issues/102)/PR #107）。[原本と確認範囲](https://github.com/kzk-maeda/itoma/blob/96152ad0d9ac6041301432fff45230478aab06b1/docs/qa/pr95-324c905/README.md)を参照する。proxy/TLSや環境公開は変更していない。

## Apple公式資料で確認した条件

確認日: 2026-11-07 JST。リンク先の現行本文を取得し、以下を区別した。

- [Configuring Family Controls](https://developer.apple.com/documentation/xcode/configuring-family-controls): 開発中のentitlementはApple Developer Programを通して利用し、本体とScreen Time ExtensionそれぞれのApp ID/capability/profileを構成する。**無料Personal Teamの通常アプリ実機実行を、Family Controls利用可能の根拠にしない。** 未登録の現状では、利用できるProgram Team/profileが確認できるまでScreen Time実機テストはBlocked。登録/購入やTeamへの参加は利用者判断であり、このPoCは実行しない。
- [Family Controls entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.family-controls): 認可API呼出し前に必要。開発用capabilityと[TestFlight/App Store用のdistribution permission](https://developer.apple.com/contact/request/family-controls-distribution)は別。Extensionも個別申請が必要。この作業では申請・署名・配布をしない。
- [Membership comparison](https://developer.apple.com/support/compare-memberships/): Personal Teamでも通常の実機テストは可能だが、App ID/端末/profileの期限や利用機能に制限がある。Xcode導入だけでScreen Timeの署名条件を満たすとは扱わない。
- [requestAuthorization(for:)](https://developer.apple.com/documentation/familycontrols/authorizationcenter/requestauthorization(for:)): 本人利用には`.individual`の非同期要求を使い、起動だけでは要求しない。native helperのAPI guardはiOS16以降。これはExpoアプリ全体の最低OSではなく、実ビルドのdeployment target/MinimumOSVersionを別途確認する。
- [FamilyActivitySelection](https://developer.apple.com/documentation/familycontrols/familyactivityselection): opaque tokenを保持し、**認可を取り消すと以前のtokenが無効になる**。名前やencoded bytes/hashを識別子にしない。PoCは再起動/再認可後の適用に新しいPicker選択を要求する。古い保存を黙って削除しない。
- [Named ManagedSettingsStore](https://developer.apple.com/documentation/managedsettings/managedsettingsstore/init(named:)) / [clearAllSettings](https://developer.apple.com/documentation/managedsettings/managedsettingsstore/clearallsettings()): 名前付きstoreとその設定だけを扱う。自分のreadbackは第三者を含むOS全体の実効制限の証明ではない。
- [ShieldSettings.applications](https://developer.apple.com/documentation/managedsettings/shieldsettings/applications-swift.property): 同時に設定できるアプリtokenは最大50個。PoCは保存前/適用前の両方で上限超過を拒否し、黙って切り詰めたり既存storeを変更したりしない。
- [DeviceActivity intervalTooShort](https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/monitoringerror/intervaltooshort): 監視区間の最小長は15分。[startMonitoring](https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/startmonitoring(_:during:events:))は既存活動の上書き、密な予定/過多によるthrow、進行中区間への即時callbackを記載。**「5分後の期限を表現できない」と同義ではない。** 過去に始まる15分以上の区間やwarningTimeで短い期限を表現できるかは#50で検証する仮説で、配信精度/上限/遅延の保証は未確認。Coreの1〜30分を変更せず、JSタイマーへ置換しない。

ExpoはSDK58の[versioned docs](https://docs.expo.dev/versions/v58.0.0/)、[Module API](https://docs.expo.dev/modules/module-api/)、インストール済みSDK58 `ExpoModulesCore`の`AsyncFunction.runOnQueue`/`Utilities.currentViewController`/Sendable `Promise`を確認した。

## 実装の境界

- 通常ホームは既存モックのまま。検証入口は`/native-poc`（`itoma:///native-poc`）。製品policy/command/grant、理由履歴、曜日予定、Extensionは操作しない。
- 選択はapp-private `Application Support/ITOMA-ScreenTime-PoC/control.sqlite`へ、既存Swift `ControlRepository` schema6で保存する。製品のApp Group DBと混ぜない。最初の「検証用の保存先を作成」だけが明示create。既存の空/破損/未対応DBをcreate/open失敗から再初期化しない。
- ディレクトリはbackup除外、DB/WAL/SHMは`completeUntilFirstUserAuthentication`を設定する。実ファイルのロック前後/再起動時の保護成立は実機未検証で、#49の代わりにしない。
- 保存するopaque payloadは版・token・ランダムTargetRef。token equalityで以前のTargetRefを再利用する。JSへはランダムSelectionRef/件数/今回の起動で再選択したか、固定分類の状態だけを返す。理由、token/name、raw errorをログ/URL/スクショへ出さない。
- 本PoCはアプリだけを対象とする。Pickerでカテゴリ/Webサイトが残れば保存を拒否し、既存選択/storeを変えない。空選択も拒否。取消も保存/制限を変えない。Picker中にSQLite lockを保持しない。
- 保存ごとに新SelectionRefを作る。手動適用できるのはネイティブPickerで直前に確認した1集合だけで、画面では「いま選んだ対象」と明示する。件数が同じ過去の集合を番号だけで選ばせない。認可publisherの非approved遷移と本体の背景移行で適用資格を失効する。再起動/背景復帰後も保存済み集合を一覧できるが、停止中の取消→再許可を見逃した古いtokenの適用を避けるため、そのままの適用は拒否する。新しいPicker保存の後、改めて本人の手動制限確認が必要。これは製品で設定復元を完了したという意味ではない。
- 手動制限は専用`itoma.poc.manual` storeだけ。書込み→own-store readbackの一致/不明を返し、実アプリを開く観測と区別する。自動終了しない。停止はDB/認可/選択読取なしで、この専用storeだけを消去する。再認可で自動適用せず、他の制限元へ触れない。

## Macでの準備（署名操作の前に確認）

通常の署名不要QAは[iOS QA](ios-qa.md)を使う。Simulatorは認可/Picker/DB作成/制限を無効化し、状態の表示・transport・コンパイルだけを確認する。実機用capabilityを有効にする必要はない。

実機では、先に利用可能なProgram TeamとFamily Controls対応profileを利用者が確認する。本人の登録・費用・署名構成を勝手に変更しない。本体bundle IDは現在`com.example.itoma`であり、使用可能なID/Teamを別途決める。デモの公開やEAS loginは前提にしない。

既存Teamがない場合は、本人が[有料のApple Developer Programへ加入](https://developer.apple.com/programs/enroll/)して開発用Teamを用意する必要がある。登録・費用・本人確認・契約は本人の操作と判断で行い、この作業は代行しない。無料Personal TeamをFamily Controls対応Teamとして案内しない。TestFlight/App Store向けFamily Controls配布申請は別工程で、今回の開発PoCの準備と混同しない。

Team/署名設定を扱う前の生成内容確認:

```sh
npm ci
ITOMA_SCREEN_TIME_POC=1 npx expo config --type introspect
```

`ITOMA_SCREEN_TIME_POC=1`は生成configのFamily Controls entitlementと`ITOMAScreenTimePoC`フラグだけを有効にする。Team選択、App ID登録、profile取得、Developer登録、費用、distribution permission申請は行わない。既存ios/を上書きせず、専用の新しいcheckoutでCNGを行う。署名・実機installは条件と利用者判断が揃ってから行い、ここでは実行していない。

同じフラグで作った実機用ビルドから`itoma:///native-poc`を開く。開発中は同フラグのMetro起動を使える。現時点で実機用binaryは作成/配布していない。停止できない場合の本人向け外部手段は、iOS設定で本アプリのScreen Time認可を取り消すこと。実際の設定名称/手順は対象iOSで確認し、他アプリの設定を一括消去しない。

## 最初の実機試験

実施前に端末/iOS、Xcode、commit/JS bundle、build ID、生成entitlement、署名profileと構成一致を記録する。本人の対象はSE第3世代/iOS27.0.1/Xcode27.2。クラウドのiPhone17 Pro/iOS26.5/Xcode26.6の結果を、その実機結果へ転用しない。[AppleのXcode対応表](https://developer.apple.com/xcode/system-requirements)も確認した。Team/端末の識別子・証明書・token・本人データは証跡へ貼らない。まず少数の、本人が試験に選んだアプリを使う。

| ID | 手順 | 期待する観測 | 現在 |
| --- | --- | --- | --- |
| MP01 | opt-inなし/Simulatorで開く | 操作不能の理由。制限成功の表示なし | 実機未実施 |
| MP02 | 「認可を要求」で拒否→再要求して許可 | 現在の拒否/認可を分離。自動Shieldなし | 未実施 |
| MP03 | 保存先作成→アプリ選択→取消 | 保存集合とShieldに変更なし | 未実施 |
| MP04 | 少数アプリを選択→保存 | 件数とrefだけ。保存完了、Shield開始なし | 未実施 |
| MP05 | 選択行の制限確認→取消→再度確認して要求 | 取消では変化なし。要求後はown-store readback、実アプリを開いてShieldの有無を別途観測 | 未実施 |
| MP06 | 別の非対象アプリを開く→検証用制限停止 | 対象外は変更なし。停止readbackと実アプリ解除を別々に記録 | 未実施 |
| MP07 | 制限状態で本体kill/再起動・オフライン | 自動再適用なし。保存集合を読取可能。以前の選択の直接適用は拒否、新Picker選択で本人が再要求 | 未実施 |
| MP08 | 認可取消→復帰→再認可 | 取消を反映。保存は保持。新Picker選択なしの適用拒否、自動再開なし | 未実施 |
| MP09 | DB不可/既存空/破損/将来schemaを検証fixtureで用意 | 自動初期化なし。保存失敗を表示、専用store停止を妨げない | 実機未実施 |
| MP10 | SEの375×667pt、Light/Dark・文字拡大・VoiceOver・Reduce Motion・往復 | 状態/保存/取消/停止へ到達可能、購読が残らない | 実機未実施 |

実機のPASS/FAIL/BLOCKED/NOT RUNは[poc-plan](system/poc-plan.md)の証跡形式で残す。まずMP02〜06を各3回行う案とするが、これは製品採否基準の採用ではない。対象OS/反復回数/期限の許容遅延/失敗時の仕様は#26でレビューする。本PRのコンパイル・transport成功だけで#8/#12/#13/#26を閉じない。
