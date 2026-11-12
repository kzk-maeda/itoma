# Device Farm実行手順

[E2Eの入口](README.md) / [シナリオの保守](scenarios.md) / [構成と判断理由](architecture.md)

## 前提と実施順

1. 初回だけAWS Project/Pool・IAM・GitHub Secrets/Variablesを設定する。
2. 変更対象のsource/JS SHAを含むRelease/iphoneos IPAを、同repoの成功したproducer runのartifactへ保存する。
3. Actionsの **iOS Device Farm E2E** を手動で起動し、producer run ID・artifact名・source SHA・IPA SHA256を渡す。
4. Actionsの合否と回収した端末ごとのJUnit・画像・動画を確認し、PRへ証跡を記録する。

GitHub runnerでAWSの呼出しまで行う場合はPython3.12とboto3を使う。ローカルの基盤回帰・梱包はNode24/npmとPython3.12が必要で、boto3はAWS実行時だけ必要。[workflow定義](../../.github/workflows/device-farm-e2e.yml)がCIの実行環境を用意する。画面テストのコードと更新手順は[シナリオの保守](scenarios.md)にある。

このworkflowは署名済みIPAを受け取る。IPAビルド/Apple登録/署名/EASの接続設定は別の準備で、現在このrepoにIPA producerは含まれていない。AWS Secretsを設定するだけでIPAが作られる構成ではない。新規インストール・本人データなしで使用する。

## 1. 初回設定

### AWS

AWSコンソールのDevice FarmでProjectを作り、使用する公開端末のARNを確認する。PoolをCLIで作る場合は、次の`PROJECT_ARN`と`DEVICE_ARN`を実際の値へ置き換える。初期構成は1台に限定する。

```sh
aws devicefarm create-device-pool --region us-west-2 \
  --project-arn PROJECT_ARN --name itoma-ios-smoke --max-devices 1 \
  --rules '[{"attribute":"ARN","operator":"IN","value":"[\"DEVICE_ARN\"]"}]'
```

`us-west-2`の**自分のProject配下のDevice Pool**を使う。最初は公開iPhone1台へ固定し、`maxDevices=1`を明示する。無制限pool/汎用curated poolはこのworkflowで使わない。IPAアップロード後、互換性・端末数・OS・公開fleetを確認してからScheduleRunする。確認済み端末ARNのfilterと台数をScheduleRunへ固定して渡し、実行中のpool編集による対象拡大を防ぐ。不適合端末や端末ゼロは失敗とする。

GitHub Settings → Secrets and variables → Actionsへ次を設定する。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| Variable | `DEVICE_FARM_PROJECT_ARN` | `arn:aws:devicefarm:us-west-2:ACCOUNT_ID:project:PROJECT_ID` |
| Variable | `DEVICE_FARM_DEVICE_POOL_ARN` | `arn:aws:devicefarm:us-west-2:ACCOUNT_ID:devicepool:PROJECT_ID/POOL_ID` |
| Variable | `ITOMA_IOS_BUNDLE_ID` | IPAの実際のbundle identifier。例: `com.example.itoma` |
| Secret（推奨） | `AWS_ROLE_ARN` | GitHub OIDCで引き受けるrole |
| Secret（アクセスキー方式） | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | roleを使わない場合のキー2点 |
| Secret（任意） | `AWS_SESSION_TOKEN` | 一時アクセスキーを使う場合 |

OIDCとアクセスキーの両方があればOIDCを優先する。OIDC providerのaudienceは`sts.amazonaws.com`、trust policyのsubjectは実行を許可するbranchへ限定する（mainなら`repo:kzk-maeda/itoma:ref:refs/heads/main`）。PR前の試験では対象作業branchだけを明示して許可し、任意のfork/PRへSecretsを渡さない。値をチャットやリポジトリへ書かない。

実行roleの権限例は[device-farm-iam-policy.json](device-farm-iam-policy.json)。`ACCOUNT_ID`/`PROJECT_ID`/`POOL_ID`を置き換える。Project/Pool作成権限、署名情報、課金設定変更権限はrunnerに不要。ScheduleRun自体のAWS SDK再試行を無効にし、通信応答不明時の二重有料実行を避ける。

### IPAを用意する

このworkflowは既存の**Release・iphoneos向けIPA**を受け取る。署名/Apple登録/EASの新規接続・ビルド・配布は実行しない。Expo GoやSimulator用`.app`、Metroへの接続が必要なdevelopment client、暗号化されたApp Store配信IPAは対象外。

ビルド側で、埋込みJSの作成時に`EXPO_PUBLIC_BUILD_SHA`を実際の40桁source commitへ設定する。この値は公開情報で秘密ではない。通常の起動を検証するため`EXPO_PUBLIC_NATIVE_SMOKE`は有効にしない。公開端末のUIスモーク用には`ITOMA_SCREEN_TIME=0`で構築できる（実制限機能を含まないビルドであることを記録する）。製品設定を含むIPAでは再署名による機能停止/起動失敗も観測結果として扱う。

同じrepoの`push`または`workflow_dispatch`で起動した既存のIPAビルドjobに、以下の保存stepを入れる。producer runはテストしたsource commitと同じ`head_sha`で成功している必要がある。PR/fork起点のartifactは受け取らない。

```yaml
# 先行stepが、このrunのsource SHAを含む署名済みIPAを作成していること。
- uses: actions/upload-artifact@v7
  with:
    name: device-farm-ipa
    path: signed/itoma.ipa
    if-no-files-found: error
    retention-days: 7
```

IPA artifactにはIPAをちょうど1つ含める。APK・署名鍵・実ユーザーデータを入れない。producerで`sha256sum signed/itoma.ipa`（Macは`shasum -a 256`）を記録する。

producerのrun SHA・指定SHA・IPAのSHA256・bundle ID・iPhoneOS形式をCIで照合し、実機上でもJSのbuild markerを照合する。この組合せはnative sourceの暗号学的attestationではない。native構成/Extension/署名の一致を保証する必要があるQAでは、従来どおりビルドIDと生成native構成・実entitlementの証跡を別に残す。

## 2. 手動実行

mainへworkflowが入った後、Actions → **iOS Device Farm E2E** → **Run workflow**を開く。実行するbranchを選び、次を渡す。

| 入力 | 例・意味 |
| --- | --- |
| `app_run_id` | IPA producerのActions run ID |
| `app_artifact` | `device-farm-ipa` |
| `app_commit` | IPAに含まれるsource/JSの40桁SHA |
| `ipa_sha256` | 対象IPAの64桁SHA256 |

またはCLIで起動できる。以下の値は実際の入力へ置き換える。

```sh
gh workflow run device-farm-e2e.yml --ref main \
  -f app_run_id=PRODUCER_RUN_ID \
  -f app_artifact=device-farm-ipa \
  -f app_commit=FULL_SOURCE_SHA \
  -f ipa_sha256=IPA_SHA256
```

### 実行状況とartifactの取得

Actionsのrun画面で各stepとsummaryを確認する。CLIでは以下の値を実際のrun ID/attemptへ置き換える。

```sh
gh run list --workflow device-farm-e2e.yml --limit 5
gh run view E2E_RUN_ID --log-failed
gh run download E2E_RUN_ID --name device-farm-E2E_RUN_ID-ATTEMPT \
  --dir device-farm-output/E2E_RUN_ID-ATTEMPT
```

`run.json`でrun/端末ごとの結果と`errors`を確認し、`artifacts/`のCustomer Artifacts ZIP内の`junit.xml`、`session.json`、画像、UI hierarchyと動画を開く。PRへ影響シナリオ・E2E run URL・IPA/source/JS SHA・観測結果を残す。手動実機実行の成功と、ローカル基盤回帰の成功は分けて記録する。

## 3. 合否・証跡・異常時

`ScheduleRun`後、run ARNを直ちに`run.json`へ保存する。APIの結果が`PASSED`でも、端末jobの欠落/失敗、成果物回収の失敗、端末ごとの登録済み全シナリオのJUnitやbuild情報の不一致があればActionsは失敗する。WARNED/SKIPPED/ERRORED/STOPPEDは合格扱いしない。AWSのTest insightsは有効にせず、JUnitをCustomer Artifactsとして回収する。

Actions artifact `device-farm-RUN_ID-ATTEMPT`は7日保持し、以下を含む。IPA・テストパッケージ・Secrets・一時署名URLは再アップロードしない。

- `input.json`: 登録シナリオID一覧、app/test SHA、元artifact、IPA/テスト/spec digest、bundle/version情報。アプリSHAは入力の出所とruntime markerによる確認でありnative attestationではない。
- `run.json`: ARN、状態、合否、device minutes、端末別結果、エラー、回収ファイルのdigest。署名URLは保存しない。
- `artifacts/`: job/suite/testを辿って回収した動画、ログ、画像、Customer Artifacts内のJUnit・session情報・UI hierarchy。1ファイル500MiB、合計2GiBを上限とし、超過は回収失敗として記録する。

失敗時も独立した`always()` stepで停止・回収を行い、作成したuploadだけを削除する。結果run/Project/Poolは削除しない。SIGINT/SIGTERMでも停止を要求する。ScheduleRun応答を失った場合は、このActions run/attempt固有名からARNを探索し、再Scheduleしない。

runnerの強制終了・認証失効・AWS障害では停止stepまで届かない可能性がある。その場合は`run.json`またはAWSコンソールの`itoma-RUN_ID-ATTEMPT`を確認して停止する。jobの10分上限も有効だが、停止保証や固定料金の上限を意味しない。料金は実際のDevice Farm利用量で確認する。

新規インストール・本人データなしの専用テストだけを使う。理由入力や本人データのある端末を加える場合は、そのシナリオの画像/動画/UI hierarchyの保存範囲も変更する。

### 失敗した場合

| 失敗箇所 | 確認と次の操作 |
| --- | --- |
| 入力/出所の検査 | Secrets/Variables、producerの成功、run SHA、artifactの有効期限/個数を確認する |
| IPA検査/実機build marker | IPAのdigest・bundle ID・iPhoneOS形式・埋込みJS SHAを確認し、必要なら対応IPAを作り直す |
| upload/互換性 | `run.json`のエラー、poolの明示上限、公開iOS18+端末とIPAの互換性を確認する |
| シナリオ/証跡照合 | 失敗したID、JUnit、画像、動画を確認する。意図した機能変更なら同じPRでシナリオを更新し、それ以外はアプリ/基盤を修正する |
| timeout/停止/cleanup | AWSコンソールとrun ARNで終了/停止済みかを確認する。新しい実行を始める前に残ったrunへ対処する |

変更したシナリオを試すときは、それを含むworkflow refを選ぶ。新しいsourceで確認する場合は対応IPAを渡す。回収失敗や未実行をPASSへ変更するために判定を弱めない。

## 4. ローカルでの検証

```sh
npm run test:device-farm
npm ci --prefix e2e --ignore-scripts --no-audit --no-fund
```

前者はAWSアクセスなしで、入力拒否、upload失敗、pool制約、待機timeout、停止、応答不明からの回復、ページング、失敗時回収、証跡/ビルド一致を追試する。Nodeシナリオの構文も検査する。これはAppium/WDA/iOS実機の実行ではない。

`prepare.py --help`でIPAの検査・パッケージ作成だけを実行できる。生成ZIPには依存込みのnpm tarballが1つ入り、test hostではoffline installする。アプリ本体のnpm依存へAppium/WebdriverIOを追加しない。Linux上でDevice Farmを使わずに実iOS/WDAの成功を主張しない。既存[Simulator QA](../ios-qa.md)・手動実機PoCを併用する。
