# 署名不要のiOS Simulator QA

Device Farm公開実機での手動E2Eは[別workflowと手順](device-farm-e2e.md)を参照。Simulatorのbridge検証、公開実機UIスモーク、署名済み端末でのScreen Time実効検証はそれぞれ結果を分ける。

[#94](https://github.com/kzk-maeda/itoma/issues/94)、親[#9](https://github.com/kzk-maeda/itoma/issues/9)/[#10](https://github.com/kzk-maeda/itoma/issues/10)。Linuxの型/Swiftテストと、macOSのビルド・Simulator・実機を分けて記録する。

## 手動で起動する

- 同じrepoの対象PRへ`ios-qa`ラベルを付ける。ラベル付与時のhead SHAを固定して実行する。新commitの再検証はラベルを外して付け直す。
- workflowがmainへ反映された後は、Actionsの **iOS Simulator QA → Run workflow** へ40桁のcommit SHAを渡して実行する。branch名や短縮SHAは受け付けない。

標準`macos-26` arm64 runnerを使う。公開repoの通常runnerを前提とし、大型runner/EAS/Apple登録を追加しない。通常のPR作成やpushだけでは起動しない。同repo PRの明示ラベルかworkflow_dispatchだけで開始する。fork PRのラベル起動は除外し、jobはcontents:read・checkout credentials非保持・Secrets追加なし。`Ready`によるIssue実装の自動起動とは別。

workflowと[runner-images](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)のXcode/CocoaPods版は更新され得るため、実行時の実版をresult.jsonへ記録する。

SwiftPMはiOS15.1とMacテストhostのmacOS13を最低版として明示する。Mac UIを製品へ追加する意味ではない。CocoaPods側の最低iOSも15.1で揃え、Coreの固定UTC計算は新しいTimeZone.gmtへ依存させない。

## 検証すること

1. source commit一致と、tracked/非ignored untracked sourceのcleanを確認する。出力dirは新規作成を必須とし、古いログ/画像を再利用しない。
2. 利用可能なiPhone type/runtimeから専用の新しいSimulatorを作り、boot/bootstatusを先に確認してshutdownする。hostの起動失敗を長いビルド前に検知し、コンパイル中はSimulatorのメモリを解放する。preflight成功をアプリbuild/install/bridge成功には数えない。
3. Mac上で共通Core/Storage/Controlの既存Swiftテストを実行し、Swift Testingの非ゼロ成功件数を記録する。XCTest側の0件表示だけでは合格にしない。Apple-hostedテストでありiOSの実OS検証とは分ける。
4. 新しいcheckoutで`expo prebuild --platform ios --no-install`、ios/を作業dirにしてpod installを実行する。SDK58 autolinkingは作業dirのPodfile.properties.jsonからextraPodsを読むため、repoルートの`pod install --project-directory=ios`へ置換しない。`ios/`が既にある場合は保護のため拒否する。`prebuild --clean`や既存projectの上書きを行わない。
5. Release/iphonesimulator・署名無効でビルドする。
6. 同じ自分のSimulatorを再びbootし、install/launchする。既存deviceのUDIDは使わず、自分がcreateしたUUIDだけを最後にshutdown/deleteする。
7. CI専用のJSフラグでSwift Coreの5分/0分入力とPoC snapshotを検証する。その後JS内の`router.replace`で`/native-poc`へ移動する。`simctl openurl`はOSの「Open in itoma?」確認で止まるため、画面到達の根拠に使わない。
8. PoC画面が自身でread-only snapshotを取得し、`simulator-unavailable`・未認可/保存なし/対象なしを再確認する。次にHistory画面へ移り、新historyVersionのprivate pageが未作成であることを画面自身のread-only取得で確認してホームへ戻る。戻ったホームのmount後だけPASS markerを出す。実機/非Simulatorの結果なら新しい履歴読取を呼ばず失敗にする。認可・理由本文取得・保存・制限操作はしない。
9. Light/DarkそれぞれOS外観を設定し、新しく起動したプロセス・別ログでbridge→PoC→History→homeの証明を再取得して`home-light.png`/`home-dark.png`を保存する。起動時の外観確認であり、稼働中の外観切替の合格は意味しない。画像生成を目視の合格と扱わない。旧sourceのhome.png/native-poc画像もupload対象に残す。

`EXPO_PUBLIC_NATIVE_SMOKE=1`と`EXPO_PUBLIC_BUILD_SHA`はcompiled JSへ含まれる公開情報。秘密や本人データを置かない。native起動には別の`SIMCTL_CHILD_ITOMA_NATIVE_QA=1`を使い、通常起動でsmokeを実行しない。通常ホームは製品bridgeへ接続する。Simulatorでは利用不可を表示し、架空の時間・制限状態を表示しない。[通常フローQA](qa/main-application-flow.md)の合成Web画像とは別の検証である。

## 証跡と判定

Actions artifactはresult.json、ビルド/Swift/起動ログ、ホームのLight/Dark画像を7日保存する。互換のため旧sourceのhome.png/native-poc画像もupload対象に残す。app binary、derived data、Swift build cacheは配布しない。

stageの全履歴は通常ログとresult.jsonへ残し、GitHub check-runのnoticeは最終結果の1件だけに使う。runnerのstep・種別ごとの10件上限で後段の結果が欠落しないようにする。最終注釈はstatus/cleanup、source/native/JS SHA、build ID、構成・digest・tool実版・成功stage件数を固定フィールド/長さで要約し、4096文字のmessage上限内に収める。新しいmetadataや全stage、完全なtool情報はresult.jsonを正本とし、API要約の省略・短縮と区別する。

失敗時はerror注釈1件と最大8件・各1200文字のcompiler/test/Simulator診断を出す。tool失敗は固定subcommand名とexit/signal/codeをresult.jsonへ保存し、argv全体・実データ・system-wide Simulator logは出さない。URLのpath/queryやcredentialsを注釈へ出さず、workflow commandの改行/percentをescapeする。画像・全文取得にはActionsのlogs/artifact配信hostへの通信許可が別途必要。cleanup失敗は先行するsmoke成功を全体失敗へ変更する。多数stage、tool失敗、cleanup失敗、巨大metadataの合成ライフサイクルは`npm run test:ios-tools`で検証する。これはSimulator実行の代用ではない。

result.jsonにrequested/source/native/JS commit、workflow commit、build ID、Release/SDK/architecture/signing、Xcode/Swift/CocoaPods実版、生成config fingerprint、埋め込まれたJS bundle digestを残す。未ビルド段階のnative/JS SHAはnullとし、実行希望を成功済みと記録しない。古いcommitのmarkerは合格にせず、画像取得後にも対象SHAのfailをpassより優先して確認する。PRを更新したら前の結果は`stale native build`とする。

対象runのログと画像を確認してPRへ結果を追記する。CNG、compile、install、bridge、画像取得の各段階を別々に記録し、失敗・未実施をPASSにしない。UIの変更があるときはDESIGNとUI受入ID、Light/Dark・文字拡大・VoiceOver等の証跡を追加する。

## このQAで保証しないこと

設定シート/反映/取消を含む全UIスモーク、VoiceOver/Reduce Motion、実OS制限・Family Controls認可、App Groups保護、callback配信、実機kill/再起動は未検証。ホーム画像だけで#10や#26/#49/#50/#52を閉じない。Apple Developer/開発署名/実機は#8へ残す。購入・申請・署名変更・配布・公開をこのworkflowの許可から推測しない。

## Macで同じ手順を使う

Node24、XcodeとiOS Simulator runtime、CocoaPodsが必要。専用の新しいcheckout/worktreeでnpm ci後に実行する。

```sh
itoma_qa_sha="$(git rev-parse HEAD)"
ITOMA_QA_COMMIT="$itoma_qa_sha" \
EXPO_PUBLIC_BUILD_SHA="$itoma_qa_sha" \
EXPO_PUBLIC_NATIVE_SMOKE=1 \
ITOMA_DEMO_BUILD=0 \
node scripts/ios-qa.mjs
```

生成ios/が残るため、そのcheckoutの既存native projectを自動で消して再実行しない。次の実行は新しい検証checkoutを用意する。Linuxではツールの入力テストだけを実行し、Simulator成功として扱わない。
