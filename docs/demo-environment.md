# ブランチ別のITOMA Webデモ

[ADR 0001](adr/0001-cloudflare-web-demo.md) に関連するセットアップです。ADRの状態はProposedのまま、ユーザー依頼のパス分離を実装・検証します。

## URLと環境の単位

```text
https://itoma-demo.kzk-maeda.com/demos/<branch-key>/
```

`branch-key` はブランチ名の小文字slug（先頭36文字）＋元の名前のSHA-256先頭12桁です。例えば `feat/a` と `feat-a` でも識別子は異なります。完全なブランチ名はmanifestに残します。

- 同じブランチを更新すると同じURLの内容だけが更新されます。
- ブランチごとにWorkerと2本のRouteを持ちます。別ブランチのファイルを集め直す必要はありません。
- `https://itoma-demo.kzk-maeda.com/` の初期デモはそのまま残します。新スクリプトは初期デモWorkerを更新しません。
- カスタムドメイン・DNS・本人限定Accessはホスト全体で共通です。ブラウザ保存領域は同一オリジンで共有されるため、将来永続保存する場合はbranch-keyごとに分離します。

現在のブランチのURL・Worker名・Routeを確認します。

```bash
npm run demo:info
```

## 閲覧

1. `demo:info` のURLを末尾の `/` を含めて開く。
2. Cloudflare Accessで許可された本人メールに届くワンタイムコードで認証する。
3. アプリ・モードの選択や取消を試す。OS制限・実課金は行われない。

`<URL>demo-build.json` でブランチ名・SHA・ビルド日時を確認できます。URLと対象SHAを検証Issue・PRに記録してください。ページを再読込すると、現在のメモリ内設定は初期化されます。

## GitHub Actionsからの自動配信

`.github/workflows/deploy-demo.yml` は、このリポジトリの **main以外のすべてのブランチへのpush** で起動します。PRがないブランチも対象です。main・タグ・forkからのPRでは配信しません。既存の `CI / quality` は引き続きPRとmainの品質チェックを担当します。

```text
push → npm ci → 型チェック・lint・テスト → demo:package
     → GitHub上のブランチ先頭SHAを確認 → demo:deploy → 実行SummaryにURL
```

- 配信workflow自身が全チェックに成功した成果物だけを使います。ローカルでビルド済みである必要はありません。
- 同じブランチの実行は `concurrency` で直列化し、進行中のアップロードを新しいpushで中断しません。配信直前に先頭SHAを照合し、古い実行の再実行や削除済みブランチの配信はスキップします。別ブランチは並列配信できます。
- `actions/checkout` のGit資格情報は保持せず、`GITHUB_TOKEN` はcontents:readのみ。Cloudflareトークンは配信ステップだけに渡します。
- この自動化はリポジトリへpushできるメンバーを信頼する構成です。配信スクリプトもブランチのコードを実行します。未信頼コードを取り込むブランチへpushする前にレビューし、fork PRのコードを資格情報付きで実行する `pull_request_target` 等は使いません。
- 本人限定Accessは既存ホスト全体に適用されます。配信トークンにはAccessを変更する権限を付けません。
- 配信に成功するとActionsのSummaryにURL・SHA・Worker名を記録します。Version IDは配信ステップのログに出ます。初回のcf betaエラーを成功扱いにせず、必要なら下記の再実行手順を使います。
- `workflow_dispatch` も用意しています。workflowをmainへマージした後、Actions → Deploy demo → Run workflowで対象ブランチを選択できます。古いSHAを配信したい場合は、その内容をブランチ先頭へ新しいコミットとして反映します。
- Gitブランチの削除ではWorker・Routeを自動削除しません。下記の撤去手順で整理してください。

### 認証設定（初回のみ）

CloudflareとGitHubのGit連携アプリは不要です。ActionsからAPIトークンで配信します。ローカルの `cf auth login` はActionsに引き継がれません。

1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) で `itoma-github-demo-deploy` などの専用トークンを作成します。Global API Keyは使いません。
2. 対象アカウントを既存デモのアカウント1件、zoneを `kzk-maeda.com` だけに限定し、次の権限を設定します。

   | 対象 | 権限 | 理由 |
   | --- | --- | --- |
   | Workers product（対象アカウント） | **Admin** | 新しいブランチ用Workerの作成。既存WorkerだけのEditorでは作成できない |
   | Account Settings | Read | 配信先アカウントの参照 |
   | Zone: `kzk-maeda.com` | Zone Read | 設定のzone名から対象を解決 |
   | Zone: `kzk-maeda.com` | Workers Routes Write（UIによってEdit表記） | ブランチ別Routeの作成・更新 |

   新しいWorkerの作成にはWorkers product単位のAdminが必要で、未作成Workerだけへの個別スコープは指定できません。このトークンは対象アカウント内の他Workerも操作できるため、リポジトリへの書込み権限を持つ人を信頼する運用に限定します。Cloudflare全体の管理者権限は不要です。古いWorkers Scripts Editを既存Worker用Editorと同等として扱う現行仕様があるため、Editorだけで新規作成できると仮定しません。権限の詳細は [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/) を参照してください。

   DNS Write・Access管理・KV・R2・D1・課金・APIトークン作成権限は付与しません。有効期限を設定し、期限前にGitHub側のSecretを更新します。GitHub標準runnerのIPは変わるため、固定IP制限を設定する場合は別のrunner構成が必要です。

3. [GitHub Actions Secrets / Variables](https://github.com/kzk-maeda/itoma/settings/secrets/actions) へ登録します。

   | 種類 | 名前 | 値 |
   | --- | --- | --- |
   | Repository secret | `CLOUDFLARE_API_TOKEN` | 手順1で作成したトークン（要登録） |
   | Repository variable | `CLOUDFLARE_ACCOUNT_ID` | `7d660105fcd8d3e983ac8f9c354b19d8`（登録済み） |

   CLIで登録する場合は下記を実行し、対話プロンプトにトークンを入力します。チャット・コマンド引数・ソースへ貼りません。

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo kzk-maeda/itoma
   ```

4. 対象ブランチへpushするか、認証未登録で失敗したActions実行を **Re-run failed jobs** します。型チェック等の成功、配信ログのVersion ID、SummaryのURL・SHA、匿名アクセス時のAccess転送、本人ログイン後の画面とmanifestを確認します。

Secretやアカウント変数が未登録の場合は配信ステップで設定手順を示して失敗します。Workers Adminなど作成権限の不足・失効・対象zoneの不一致はAPIエラーとして失敗するため、ログの権限エラーを確認してください。トークンの値はログへ出しません。設定を止める場合はworkflowを無効化し、トークンを失効します。環境自体の撤去は別操作です。

参考: [cf in CI](https://developers.cloudflare.com/cf/ci/)、[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。APIトークン登録後のActionsからの本番配信は、現時点では未検証です。

## ローカルからのビルド・配信

Node.js 24とnpmを使用します。実際の作業ブランチをチェックアウトしてから実行してください。

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test -- --ci --runInBand
npm run test:demo
```

変更をコミットし、作業ツリーをクリーンにしてから実行します。

```bash
npm run demo:info
npm run demo:package
npx cf deploy --prebuilt --dry-run
npm run demo:deploy
```

- `demo:package` は現在のブランチ用の静的exportとcf buildを行います。生成先 `dist/demo` の以前のファイルは消してからexportします。
- デモビルドだけ `web.output=static` と `experiments.baseUrl=/demos/<branch-key>` を適用します。通常のWeb・iOS設定は維持します。
- export結果を `dist/demo/demos/<branch-key>/` に配置し、通常の静的ファイル配信でパスを処理します。Cloudflareの非ルート `assets.basePath` はアカウントで未有効（API 100343）だったため使用しません。
- `demo:deploy` は現在のbranch・SHA・dirty状態、manifest、Worker名・Route・basePathと公開設定を照合します。古いビルドや別ブランチの成果物は拒否します。
- ブランチを切り替えたら、同じSHAでも必ず再パッケージします。ローカルdetached HEADは拒否します。GitHub PRのdetached checkoutはGITHUB_HEAD_REFを使います。
- cfとWranglerは版固定です。rootのpackage type未指定によるNodeの警告は出ますが、ビルド可能です。

配信対象は既存の本人Cloudflareアカウントです。複数アカウントを使う場合は `CLOUDFLARE_ACCOUNT_ID` を明示します。Actionsからの配信は上記workflowを使い、ローカルでは本人のログインまたは専用APIトークンを使います。

新規Workerの初回配信では、アップロード後に10007/404やnullのtag参照でcfが失敗した事例があります。失敗を成功として扱わず、対象WorkerがCloudflare APIで確認できることと公開設定を確認してから、同じブランチ・コミット・成果物で `npm run demo:deploy` を再実行してください。変更した場合はコミットして再パッケージします。再実行でも失敗する場合はログを確認し、共通ホストや他ブランチの設定を変更しないでください。

## 保護と再現性

Accessはデモホスト全体を対象にするため、新しいパスにも適用されます。未ログインでHTML・JS・画像・manifestがAccessへ転送されることと、本人ログイン後の表示を確認します。

workers.dev・version previewは各Workerで無効にし、認証を迂回するURLを作りません。各配信のVersion IDも記録してください。
パスはセキュリティ境界ではありません。Cookie・localStorage等は自動的に分離されず、別デモのコードも同じオリジンで動きます。未信頼の第三者コードはこの構成の対象外です。

## 終了・削除・復旧

1. 対象のGitブランチをチェックアウトし、`npm run demo:info` でWorker名と2本のRouteを確認する。
2. Cloudflareの対象zoneのWorkers Routesで、そのWorkerに紐付く2本だけを削除する。
3. 対象Workerを削除する。共通Worker `itoma-demo`、Custom Domain、DNS、Access、ほかのWorkerは削除しない。
4. 該当パスがデモを返さないことと、別ブランチが引き続き表示されることを確認する。

削除は明示的な依頼で実行し、自動化はしていません。Gitブランチを消しただけではCloudflare環境は消えません。Worker・Routeの上限と費用を考慮して不要環境を整理します。
旧版へ戻す場合は、元の名前のブランチで対象コミットを再パッケージ・配信します。ブランチ名を変えるとURLも変わります。SHAだけのdetached checkoutで配信しません。

## リソース・検証範囲

作成したリソースは [Cloudflare一覧](cloudflare-resources.md) に記録します。Webでの表示・操作確認はScreen Time、実機、VoiceOver、Dynamic Typeの確認とは別です。実データや秘密情報はデモに入力しません。
