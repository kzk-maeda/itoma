# ブランチ別のITOMA Webデモ

[ADR 0001](adr/0001-cloudflare-web-demo.md) に関連するセットアップです。ADRの状態はProposedのまま、ユーザー依頼のパス分離を実装・検証します。

## URLと環境の単位

```text
https://itoma-demo.kzk-maeda.com/demos/<branch-key>/
```

`branch-key` はブランチ名の小文字slug（先頭36文字）＋元の名前のSHA-256先頭12桁です。例えば `feat/a` と `feat-a` でも識別子は異なります。完全なブランチ名はmanifestに残します。

- 同じブランチを更新すると同じURLの内容だけが更新されます。
- ブランチごとにWorkerと2本のRouteを持ちます。別ブランチのファイルを集め直す必要はありません。
- `https://itoma-demo.kzk-maeda.com/` は環境一覧に置き換えます。ブランチ配信スクリプトはルートWorkerを更新せず、一覧専用workflowが更新します。
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

## 一覧から開くページ

一覧のリンクは、既存の比較デモでは次の実ページを指します。各ブランチのトップ `/demos/<branch-key>/` はExpoの初期ホームであり、比較ページとは別です。

| 環境ブランチ | 一覧から開くページ |
| --- | --- |
| `feat/design-three-demos`（既存環境） | `design-lab.html` |
| `demo/b-reason-unlock` | `design-b.html` |
| `demo/b-native-motion` | `design-motion.html` |
| `demo/color-variations` | `design-colors.html` |
| `demo/hourglass-experience` | `hourglass.html` |
| `demo/history-studies` | `history.html` |

入口は `scripts/lib/demo-index.mjs` に配信keyとの対応を持ちます。Gitブランチが削除されても環境が残っていれば同じ入口を使い、未知の環境は従来どおりトップを開きます。新しいHTML比較デモを追加するときは、この対応と `tests/demo-index.test.mjs` も更新してください。ページの存在は対象デモの配信で確認し、削除や改名をするときも対応を更新します。「配信情報」は従来どおり各環境の `demo-build.json` です。

一覧側の修正はmainへのマージ後、既存のUpdate demo indexで反映します。各デモの再配信は不要です。ブランチのトップ自体を別ページへリダイレクトする変更ではありません。

新しい静的HTMLのデモでは、`public/demo-entry.json` に `{ "page": "history.html" }` のように入口を指定できます。`demo:build` がexport後にそのHTMLを配信先の `index.html` へコピーし、トップURLでも意図したデモを開きます。相対アセットが同じ場所にある単一HTMLページのみ指定でき、存在しないファイル・外部URL・パス移動・`index.html` 自身は拒否します。未指定なら従来のExpoトップを維持します。`demo-build.json` の `entryPage` で入口を確認できます。アプリ本体のルーティングは変えません。新規デモを派生させるときは、この指定も意図したページに更新するか削除してください。

## GitHub Actionsからの自動配信

`.github/workflows/deploy-demo.yml` は、このリポジトリの **`demo/**` ブランチへのpushだけ**で起動します。`demo/rule-settings`、`demo/unlock/reason` のような名前が対象で、PRの有無には依存しません。main・`feat/**`・`docs/**`・`ci/**`・タグ・forkからのPRでは配信しません。既存の `CI / quality` は引き続きPRとmainの品質チェックを担当します。

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
- `workflow_dispatch` も用意しています。workflowをmainへマージした後、Actions → Deploy demo → Run workflowで `demo/` から始まる対象ブランチを選択できます。その他のブランチを選ぶとjobはskipされ、配信stepや資格情報を使いません。古いSHAを配信したい場合は、その内容をブランチ先頭へ新しいコミットとして反映します。
- GitHub上でブランチを削除すると `Cleanup demo` が専用Worker・Routeを撤去します。PRを閉じるだけ・ローカルのブランチ削除だけでは撤去しません。詳細は下記を参照してください。

### デモを作るブランチ

実装・設計のブランチはそのまま使い、共有したい内容から明示的にデモ用ブランチを作ります。

```bash
git switch demo/rule-settings  # 既存のデモを更新する場合
# 初回は、共有したい実装ブランチ上で git switch -c demo/rule-settings
git push -u origin demo/rule-settings
```

同じブランチへのpushで同じURLを更新します。`demo:deploy` も `demo/` 以外を配信前に拒否します。品質CIのデモビルド検証は通常のPRでも維持します。

既存の非demoブランチ環境はこの変更だけでは消しません。これまでの `feat/`・`docs/` 環境を撤去できるよう、Cleanup demoは削除済みブランチのprefixを限定しません。新しいブランチ名は別のWorker/URLとなり、既存環境の移設ではありません。

**既存ブランチへの反映**：GitHubのpush workflowはpushしたブランチの定義を使います。この変更がmainへ入っても、古いworkflowを持つブランチや過去runへ遡って制限されるわけではありません。既存の作業ブランチには更新後mainを取り込んでからpushしてください。prefix制限は運用ガードで、Cloudflare APIトークン自体の権限制限ではありません。

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
   | Repository secret | `CLOUDFLARE_API_TOKEN` | 手順1で作成したトークン（登録済み） |
   | Repository variable | `CLOUDFLARE_ACCOUNT_ID` | `7d660105fcd8d3e983ac8f9c354b19d8`（登録済み） |

   CLIで登録する場合は下記を実行し、対話プロンプトにトークンを入力します。チャット・コマンド引数・ソースへ貼りません。

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo kzk-maeda/itoma
   ```

4. 対象ブランチへpushするか、認証未登録で失敗したActions実行を **Re-run failed jobs** します。型チェック等の成功、配信ログのVersion ID、SummaryのURL・SHA、匿名アクセス時のAccess転送、本人ログイン後の画面とmanifestを確認します。

Secretやアカウント変数が未登録の場合は配信ステップで設定手順を示して失敗します。Workers Adminなど作成権限の不足・失効・対象zoneの不一致はAPIエラーとして失敗するため、ログの権限エラーを確認してください。トークンの値はログへ出しません。設定を止める場合はworkflowを無効化し、トークンを失効します。環境自体の撤去は別操作です。

2026-11-04、[Actions再実行](https://github.com/kzk-maeda/itoma/actions/runs/41828277172/job/126574264444)で配信まで成功しました。対象SHAは `6103338f981b330c4490bf20b3192e45cd23c20a`、Worker Versionは `5eccbac6-19fd-4654-ae8a-3d51fb91536d`。

参考: [cf in CI](https://developers.cloudflare.com/cf/ci/)、[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。新規ブランチ削除イベントによる本番撤去は、この変更をmainへマージした後に確認が必要です。

## ローカルからのビルド・配信

Node.js 24とnpmを使用します。ビルド・検査は通常の作業ブランチでも可能ですが、配信は `demo/<name>` ブランチだけに限定します。

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

### GitHub上のブランチ削除による自動撤去

`.github/workflows/cleanup-demo.yml` がdefault branch（現在main）へマージされた後から有効です。

```bash
git push origin --delete demo/example
```

GitHubの「Delete branch」でも同じです。PRのclose/mergeだけでは撤去せず、リモートのブランチが実際に削除された時に動きます。GitHubのマージ後ブランチ自動削除を利用している場合も、発生したdeleteイベントが対象です。過去の削除イベントには遡って動きません。

- タグ・main・default branchを除外し、削除されたブランチ名は `github.event.ref` から取得。削除済みブランチのコードはcheckoutせず、default branchのコードとNode標準モジュールだけを実行します。
- 配信と同じ `deploy-demo-refs/heads/<branch>` のconcurrencyで直列化します。削除pushを配信対象から除外し、後続イベントで進行中のアップロードを中断しません。
- GitHub APIでブランチの不存在を確認し、同名ブランチが再作成されていればスキップ。各削除の前にも確認し、途中で再作成されていたら残りの削除を止めます。
- 指定アカウントの `kzk-maeda.com` zoneのみを参照します。branch-keyに完全一致する2本のRouteとWorker名を照合し、Routeが他Workerを向く、対象Workerに別パスがある、Custom Domainや他リソースの参照がある場合は削除前に停止します。
- Route IDの現在の所有先を再確認してから削除し、その後Workerと関連Versionを削除します。強制削除は使いません。共通Worker `itoma-demo`・DNS・Custom Domain・Access・他ブランチは削除しません。
- 削除後にWorker・Routeの不存在をAPIで確認し、Actions Summaryへ対象と結果を記録。存在しないリソースは削除済みとして扱い、部分失敗からも再実行できます。APIの403・500等を不存在として処理しません。
- 使用するSecret/Variableは配信と同じです。既存トークンにWorkersの削除権限と対象zoneのWorkers Routes Writeが必要です。DNSやAccessの変更権限は追加しません。

Actionsの中断・キュー入替・API障害で完了しなかった場合は、対象実行のRe-run failed jobs、または下記の手動実行で復旧します。新しく同じブランチを作成した場合は削除せず、通常のpush配信を優先します。ブランチ再作成のタイミングによって一部Routeだけが削除された場合も、次の配信でRouteを再設定します。

### 削除対象の確認・手動復旧

Actions → **Cleanup demo** → **Run workflow** を開きます。

1. 実行元ブランチはmainを選択（コードは常にdefault branchから取得）。
2. `branch` に削除済みの元のブランチ名を入力。
3. 最初は `dry_run` をオンにして、Summary/ログのWorker名・URL・Route IDを確認。
4. 対象が正しければ `dry_run` をオフにして再実行。

ブランチがGitHub上に存在する場合は、手動実行でもスキップします。最初からデモ未配信のブランチや、削除完了済みのブランチに実行しても共通リソースを削除しません。認証前のURLはホスト全体のAccessへ転送され続けるため、匿名GETの302だけを撤去成功の証拠にしません。

### Cloudflareでの手動撤去

1. 対象のGitブランチをチェックアウトし、`npm run demo:info` でWorker名と2本のRouteを確認する。
2. Cloudflareの対象zoneのWorkers Routesで、そのWorkerに紐付く2本だけを削除する。
3. 対象Workerを削除する。共通Worker `itoma-demo`、Custom Domain、DNS、Access、ほかのWorkerは削除しない。
4. 該当パスがデモを返さないことと、別ブランチが引き続き表示されることを確認する。

自動撤去導入前から残る環境も、削除済みブランチ名を指定する手動実行で整理できます。Worker・Routeの上限と費用を考慮して不要環境を確認します。
旧版へ戻す場合は、元の名前のブランチで対象コミットを再パッケージ・配信します。ブランチ名を変えるとURLも変わります。SHAだけのdetached checkoutで配信しません。

## リソース・検証範囲

作成したリソースは [Cloudflare一覧](cloudflare-resources.md) に記録します。Webでの表示・操作確認はScreen Time、実機、VoiceOver、Dynamic Typeの確認とは別です。実データや秘密情報はデモに入力しません。

## ドメイン直下のデモ環境一覧

`https://itoma-demo.kzk-maeda.com/` はブランチデモの一覧ページとして使用します。初期デモのルート表示を置き換え、`/demos/<branch-key>/` の各Worker・Routeはそのまま維持します。Cloudflare Access、DNS、許可ポリシーは変更しません。

### 掲載対象とサマリー

- Cloudflare上に同じbranch-keyの専用Workerと、末尾スラッシュなし・`/*` の両Routeが存在する環境を掲載します。Gitブランチが存在するだけでは掲載しません。HTTPでのアプリ正常動作まで検査するヘルスチェックではありません。
- GitHubの同名ブランチに関連する自リポジトリの最新PRのタイトル・説明をサマリーにします。PRがなければブランチ先頭コミットの件名を使います。forkの同名ブランチのPRは使いません。
- Gitブランチが削除済みでも、WorkerとRouteが残っていれば環境は掲載し、ブランチ不明・削除済み・ローカル配信と表示します。#33の撤去完了後に次回更新で消えます。
- PR/ブランチの概要は現在のソース情報で、配信成功したSHAと同一とは限りません。実際の配信内容は各カードの「配信情報」（`demo-build.json`）で確認します。
- Worker更新時刻と一覧の確認時刻は日本時間で表示します。リアルタイム一覧ではなく、最後に成功した照合時点のスナップショットです。

### 更新と配信

`.github/workflows/demo-index.yml` はmainの信頼済みコードだけを使います。Deploy demo / Cleanup demo完了後、15分おき、main上の一覧関連ファイル変更時、または手動実行で更新します。Cleanup demoはPR #33で追加されるworkflow名に対応しています。

1. 既存の `CLOUDFLARE_ACCOUNT_ID`・`CLOUDFLARE_API_TOKEN` とGitHubの読取トークンで対象zoneのRoutes、専用Workers、Gitブランチ・PRを照合。
2. `scripts/build-demo-index.mjs` で静的HTMLを `dist/demo-index/` へ生成。秘密情報は出力しません。
3. 固定済みWranglerで `wrangler.demo-index.jsonc` を配信。既存ルートWorker `itoma-demo` と既存Custom Domainだけを使い、workers.dev・Version previewは無効のままにします。

取得や配信が失敗した場合、空一覧を成功扱いで公開しません。前回の一覧を保持し、Actionsの失敗を確認して再実行します。Route照合と配信の間の追加・削除は次回更新で反映されます。定期workflowの実行は遅延する場合があります。

初回はこのworkflowをmainへマージ後、Actionsの「Update demo index」を実行します。更新には既存トークンのWorker更新・Route読取・zone読取権限が必要です。新しいSecretや閲覧用の独自認証・製品バックエンドは追加しません。

ローカルで構成だけ検証する場合は、テスト用の静的HTMLを `dist/demo-index/` に置き、`npx --no-install wrangler deploy --config wrangler.demo-index.jsonc --dry-run` を使います。API取得には専用の環境変数が必要です。認証値をログやファイルに出さないでください。
