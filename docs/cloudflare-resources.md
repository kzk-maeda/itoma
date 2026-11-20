# Cloudflare 環境の設定・リソース一覧

## 正式サイトの本人限定セットアップ（2026-11-20）

本人がPR192の準備と「公開まではZero Trust配下」を指定。正式サイトはデモと別Worker/別Accessに配信した。一般公開・mainマージは実施していない。判断と公開への移行は[ADR0013](adr/0013-service-site-private-prelaunch.md)、手順は[site/README](../site/README.md)。以下の古いデモ記録は各作業時点の履歴。

| 種別 | 対象 | ID / 状態 |
| --- | --- | --- |
| 新規Worker | `itoma-site` | `f5dd108f59ee432ea0affa4c53fd3771`。静的Assetsのみ、bindingsなし、observability無効 |
| 初回Worker Version | PR192のサイト | `03988819-9881-4e73-9689-757c2f910e81`。source `b963469040413ea2c1c2f9706da3bb6e47b8a075`（PR192へmain `4817056`を取り込んだコミット） |
| 新規Custom Domain | `itoma.app` | `587b4a946cc888f73d70aa777d571dfa20b79a8d`。DNS/証明書はCloudflare管理 |
| 新規Access Application | `ITOMA site prelaunch` | `9ba56752-2e29-4d47-9087-81e351b651ac`。self_hosted、`itoma.app`全パス |
| 新規Access reusable policy | `ITOMA site owner only` | `5be1505d-360c-4efe-897d-badbb5616af2`。本人のメール1件のみallow、Everyone/Bypassなし、デモのポリシーとは独立 |
| 再利用zone | `itoma.app` | `493c4d50c15352c342db90956a5bff3a`。同アカウントでactive。zone/ドメイン購入/NS変更なし |
| 再利用IdP | メールOTP | `a71139fd-1d30-43f4-a83a-ea7d1b01acd1`。既存設定は変更なし |

Accessは24hセッション、HTTP-only Cookie有効、preflight bypassなし。許可メールの具体値・認証コード・Cookie/トークンはリポジトリに記載しない。Workerのworkers.dev/Version previewは両方false。新しいIdP・Pages・DB・KV・R2・Workers Builds・有料プランは作成/変更していない。

`support@itoma.app`は既存Email Routingがready、有効なforwardルール1件と認証済み転送先1件を確認。既存MX/SPF、転送ルール・転送先は変更していない。実受信と返信元アドレスの運用は未検証。

初回はAccessを先に作成し、APIで単一メールallowと専用ポリシーを読戻してからローカルcf認証を用いて配信。トップ・privacy・CSS/SVG・未知パスはすべて、このAccessのaudに一致するログインへ302を確認した。通常DNS `172.20.10.1` はANSWER 0/SOA（負の応答TTL1800秒）を返した。一方、両権威NS・Cloudflare/Google DNSとDoHはAを返したため、権威DNSのAを指定し実hostnameでTLS証明書を検証した。標準DNSでの配信guard成功とは区別する。本人はメール認証を通過した後のサイト本文を表示できたと報告（本人確認PASS、agentのブラウザ直接観測ではない）。拒否メールでの実試験は未実施。

CI/通常ローカル配信へ匿名Access確認を追加。mainへマージしても本人限定配信が継続する。GitHubの既存Secret/アカウント変数を維持し、値は取得していない。CIトークン権限とActions配信は別の確認事項で、ローカル認証成功を転用しない。一般公開への移行でこのサイト専用Accessを解除するまでは、認証を外して配信エラーを解消しない。

検査結果: 型/Lint/Jest280件（29 suites）/demo32件/サイト7件/ローカルHTTPとWrangler dry-runはPASS。Expo Doctorは19/20（推奨依存との差分、更新なし）。標準DNSのlive guardはENOTFOUNDで失敗したが、QA限定で権威DNSのAを使い実hostnameのTLS検証を保った同じguardコードは6パス全てPASS。これらの差を残し、初回Actions成功や未実施の拒否メール試験等を合格にしない。

private原本・API応答・配信ログはGit管理外 `.tmp/qa/site-private-20261120/` に保存する。

確認日: 2026-11-04（JST）。ユーザーの依頼で作成・配信したデモ用リソースです。ADRの採用判断とは別の、限定的なセットアップ・動作確認の記録です。
閲覧・更新手順は [demo-environment.md](demo-environment.md)、判断案は [ADR 0001](adr/0001-cloudflare-web-demo.md) を参照してください。

## 作成したリソース

| 種別 | 名前・対象 | ID | 用途・設定 |
| --- | --- | --- | --- |
| Worker | `itoma-demo` | `7bee0b5f894a4a8cbbbfc190e562abaa` | Expo Webの静的ファイル配信のみ。API・DB bindingなし。observability無効 |
| Worker Version | 初回デモ | `168b1c3f-a65a-4a32-88a1-c3392d62fde9` | 下記のコミットから作った成果物を配信 |
| Workers Custom Domain | `itoma-demo.kzk-maeda.com` | `9d8c9ad8417253b54ad0fdea0ca52103e3101738` | `itoma-demo` の配信ホスト。CloudflareがTLS・ルーティングを管理 |
| 管理DNSレコード | `itoma-demo.kzk-maeda.com` | `e2eff4a521ec5758165cf965973a619b` | Custom Domain登録時に自動作成。AAAA `100::`、proxied、read_only。手動のオリジンIP設定ではない |
| Access Application | `ITOMA demo` | `888ea372-59b2-4a8e-9c4f-bf6b0a74986f` | self_hosted。ホスト全体を認証対象にする |
| Access reusable policy | `ITOMA demo owner only` | `e2c77cdf-073c-48f7-a172-91f2bb2994a0` | allow、本人のメール1件だけをinclude。Everyone・ドメイン一括許可・Bypassなし |

これらのIDは資格情報ではありません。APIトークン、認証コード、Cookie、JWTは記録していません。

## 再利用した既存リソース

| 種別 | 対象 | 変更 |
| --- | --- | --- |
| Cloudflare account | ログイン中の本人アカウント | 新規作成・プラン変更なし |
| DNS zone | `kzk-maeda.com` | 上記の専用サブドメイン以外のDNSは変更なし |
| Zero Trust organization | `soft-sea-2b9b.cloudflareaccess.com` | 新規作成・組織全体のポリシー変更なし |
| Identity Provider | `a71139fd-1d30-43f4-a83a-ea7d1b01acd1` | 既存のメールワンタイムコード（onetimepin）を新Accessアプリで利用。IdP設定自体は変更なし |

既存の別Accessアプリ・その許可リストは変更していません。D1・KV・R2・Queues・Pagesプロジェクト・CI用トークン・新しいIdPは作成していません。

## 初回セットアップで設定した内容

- 閲覧URL: **https://itoma-demo.kzk-maeda.com**
- Accessは本人メールだけを許可。セッションは24時間、HTTP-only cookie有効、preflight bypassなし。
- Accessの許可メールの具体値はCloudflare上で管理する。メンバー追加時は明示的な依頼に基づきポリシーを変更する。
- Workerの `workers.dev` は無効。`https://itoma-demo.kzk-maeda0711.workers.dev` は閲覧用URLとして使わない。
- Version preview URLも無効。Custom Domain以外のURLによるAccess回避を防ぐ。
- Workerのcompatibility dateは `2026-11-01`。カスタムAPIコード・bindingsなし。
- 配信ファイルに `X-Robots-Tag: noindex, nofollow` を設定。検索除外は認証の代替にはしない。
- `/demo-build.json` にSHA・作業ツリーの状態・ビルド時刻・mock-onlyであることを記録し、キャッシュを無効化する。
- 初回はローカルの資格情報を用いた明示的な手動デプロイのみ。GitHub Actionsには配信資格情報を登録せず、静的ビルドだけを追加した。後続のActions配信の追加設定は末尾に記録する。

## 初回配信と検証結果

- アプリの基準main: `25b05d0120d24d1e1aeca6103b3b3235e83685df`。未マージの画面改善PR #4は含まない。
- 配信したセットアップ込みのcommit SHA: `ccbf7c22a78a4042ae782002f1fc27c9a552c9f7`。
- 成果物の `dirty`: `false`。ビルド日時: `2026-11-04T10:09:25.242Z`。
- `npm run demo:package`、`cf deploy --prebuilt --dry-run`、`npm run demo:deploy`: 成功。
- `cf workers list` から対象Worker・Custom Domainの参照と `subdomain.enabled=false`、`subdomain.previews_enabled=false` を確認。
- 未認証のブラウザ相当User-Agentで `/`、`/explore`、`/demo-build.json`、実在JS、実在PNGへGET: **すべて302でAccessログインへ転送**。
- 通常のPython User-AgentはCloudflareのBot判定で403/1010だったため、これをAccess確認の根拠にせず、上記の302を別に確認した。
- ブラウザの認証済みセッションで `/cdn-cgi/access/get-identity` が200、本人メールと一致することを確認。デモ画面表示と `/demo-build.json` の配信SHA一致、モックの注意書きも確認。
- 認証済みGETで `/` の `X-Robots-Tag: noindex, nofollow` と `/demo-build.json` の `Cache-Control: no-store` を確認。
- 未コミット変更がある状態で `demo:deploy` が配信前に終了することを確認。
- 型チェック・lint・コンポーネントテスト2件: 成功。expo-doctor: 19/20、既存の推奨依存バージョン不一致あり。

拒否対象メールによる認証の実試験、スマートフォン実機でのメール認証、長時間のセッション更新、旧版への再配信は未実施。許可リストの構造確認と、未認証時の拒否を分けて記録しています。

## ブランチ別パスの追加リソース（2026-11-04）

共通ホストの `/demos/<branch-key>/` を使います。新規DNS・Custom Domain・Accessアプリ・許可ポリシーは追加せず、既存の本人限定Accessを維持しました。

| Gitブランチ | Worker名 / ID | 配信パス | Worker Version |
| --- | --- | --- | --- |
| `feat/branch-path-demos` | `itoma-demo-feat-branch-path-demos-c79089418710` / `970a2d8f9a864abd992f1d9c72e0fdfa` | `/demos/feat-branch-path-demos-c79089418710/` | `601c3673-5fd9-4c8d-b968-e2a2d0419544` |
| `demo/path-isolation-check`（ローカル検証用ブランチ） | `itoma-demo-demo-path-isolation-check-98eb139cc452` / `057f76dcb96244c39574aad2a84f4fb2` | `/demos/demo-path-isolation-check-98eb139cc452/` | `bc71ef3b-43a2-47f8-9bfd-2b2957668a56` |

両Workerはcommit `5313ad1531a5bd424faf47714d1826c1f713c059`、dirty=falseの成果物です。各Workerに次の2本ずつ、合計4本のWorkers Routeを追加しました（zone: `kzk-maeda.com`）。

```text
itoma-demo.kzk-maeda.com/demos/feat-branch-path-demos-c79089418710
itoma-demo.kzk-maeda.com/demos/feat-branch-path-demos-c79089418710/*
itoma-demo.kzk-maeda.com/demos/demo-path-isolation-check-98eb139cc452
itoma-demo.kzk-maeda.com/demos/demo-path-isolation-check-98eb139cc452/*
```

- 各Workerのworkers.dev・Version previewは無効、Custom Domainの直接割り当て・bindings・独自APIなし。
- 2番目のブランチ配信後、最初のWorkerの `deployed_on=2026-11-04T11:19:05.025962Z` / `updated_on=2026-11-04T11:19:06.138006Z` が変わっていないことをAPIで確認。ルートの初期Workerも以前の配信日時を維持。
- 両パスのHTML・`explore`・manifest・実在JS・実在PNGへの匿名GETはすべて302でAccessへ転送。ブラウザ相当User-Agentで検査。
- ブランチ切替後に再パッケージせず配信すると、対象ブランチのmanifestが存在せず配信前に終了することを実行確認。
- サブパスのHTML・JS・manifest・直リンクはローカル静的配信で確認。Chromiumで表示、リソース読込エラーなし、YouTube選択の保存も確認。新しい本番パスの認証後表示は未確認（以前のルートURLの認証済み確認とは区別する）。
- Cloudflareの非ルート `assets.basePath` はAPI 100343で拒否されたため使用しない。ファイルを対応ディレクトリへ配置して配信。
- cf betaで新規Workerのアップロード直後に10007/404、再実行でnullのtag参照エラーを観測。WorkerをAPIで確認できた後、同じ成果物で再実行すると配信・Route設定が成功。自動リトライや成功扱いへの置換は行っていない。
- 型チェック・lint・Jest 2件・配信ガード等のテスト3件は成功。expo-doctorは19/20で既存依存バージョン不一致。

検証用ブランチの環境も現存します。自動削除はありません。ブランチ別の撤去は [手順](demo-environment.md#終了削除復旧) に従い、該当する2本のRouteとWorkerだけを対象にします。

## 停止・削除・復旧

- 即時に閲覧を止めたい場合は、Accessで対象アプリの許可を停止し、必要なら既存セッションを失効する。Workerから先にAccessを外して公開状態にしない。
- 完全撤去は、WorkerのCustom Domain・Worker本体と残るVersionを確認して削除し、DNSの管理レコードが消えたことを確認してから、専用Accessアプリ・専用ポリシーを削除する。既存zone・Zero Trust組織・IdPは削除しない。
- 撤去操作は今回は未実施。実行前に対象IDを再確認し、改めて明示的な依頼に基づいて行う。
- 表示内容を戻す場合は、前回確認したコミットから再パッケージ・再配信する。元のAccess制御を維持し、反映後のSHAと匿名アクセスを再確認する。
- リソースが存在することと費用が発生しないことは同義ではない。今回、有料プランへの変更や課金設定の変更は行っていない。利用量・保持・課金条件の継続管理は残る。

## GitHub Actions配信の追加設定

- 既存PR #30に `.github/workflows/deploy-demo.yml` を追加。main以外のブランチへのpushと手動実行で検証・ビルド・配信を行う。
- GitHub Repository variable `CLOUDFLARE_ACCOUNT_ID` に既存デモのアカウントID `7d660105fcd8d3e983ac8f9c354b19d8` を登録。
- `CLOUDFLARE_API_TOKEN` Repository secretは未登録。専用トークンの作成・登録はユーザー操作が必要。[権限・登録手順](demo-environment.md#認証設定初回のみ)を参照。
- 今回の自動化追加ではCloudflareのWorker・Route・DNS・Access・IdPは作成・変更していない。CloudflareのGit連携アプリ・Workers Buildsも設定していない。
- 認証設定後のActions経由の本番配信、連続push時の実際の配信順は未検証。既存の2ブランチ手動配信の結果とは区別する。

## ブランチ削除時の自動撤去（Issue #32）

- `.github/workflows/cleanup-demo.yml` と `scripts/cleanup-demo.mjs` を追加。GitHubのdeleteイベントでブランチ専用Worker・Routeを撤去する。手動実行はdry-runを標準とする。
- 配信と同じアカウント変数・APIトークンを再利用。対象zone名とアカウントを照合し、専用Workerと完全一致するパスだけを削除する。共通Custom Domain・DNS・Access・IdPは保持する。
- 撤去処理自体は新しいSecret・GitHub App・Cloudflareサービスを追加しない。トークンの削除権限は既存設定に依存し、権限不足は失敗として確認する。
- 先行の認証設定の状況更新: `CLOUDFLARE_API_TOKEN` は登録済み。Actions実行 `41828277172` / job `126574264444` は配信まで成功。SHA `6103338`、Version `5eccbac6-19fd-4654-ae8a-3d51fb91536d`。上記の未登録・配信未確認の記載は初期設定時点の記録。
- 自動撤去はworkflowがmainに入った後の削除イベントから有効。ローカルmockテストは実施したが、本番のdeleteイベントによる撤去はマージ後の検証が必要。過去の削除済みブランチは手動実行で整理する。

### PR #33の配信確認で作成された環境

既存の自動配信workflowが作業ブランチへのpushで作成した環境です。自動撤去処理の本番検証結果ではありません。

| 対象 | 値 |
| --- | --- |
| Gitブランチ | `feat/cleanup-branch-demos` |
| Worker | `itoma-demo-feat-cleanup-branch-demos-4fbd8d172b99` |
| Worker ID | `c482435e5cdb400490adabdbe6e32719` |
| 配信パス | `/demos/feat-cleanup-branch-demos-4fbd8d172b99/` |
| Route | `itoma-demo.kzk-maeda.com/demos/feat-cleanup-branch-demos-4fbd8d172b99` と同パスの `/*` |
| 初回配信SHA | `e5988f7ce0de0a6ae1caf8e411e2b175cd775b1b` |
| 初回Worker Version | `54e24246-e47f-46db-93e7-174082ac13be` |
| Actions証跡 | https://github.com/kzk-maeda/itoma/actions/runs/41832234714 |

初回配信は成功。Cloudflare APIでworkers.devとpreviewが無効、Custom Domainや他リソースの参照が空であることを確認しました。この記録以降の同ブランチの配信は同じWorkerを更新します。撤去workflowをmainへマージ後、このブランチを削除すれば自動撤去の対象になります。共通DNS・Custom Domain・Accessには変更を加えていません。

## 2026-11-15の残存環境調査と撤去

Issue [#205](https://github.com/kzk-maeda/itoma/issues/205)。調査対象mainは `0c2ec4ead42625c322c60087d775d65adb162e40`。delete workflowが停止していたわけではない。調査時のWorker17件は、共通一覧1件・対応するGitブランチが現存する15件・孤立1件だった。成功したcleanupが0件削除を報告するのは、元々デモ未配信のブランチでも起動するためで、これだけでは削除障害の根拠にならない。

孤立環境は自動撤去導入前の2026-11-04に作成された `demo/path-isolation-check`。今回、既存cleanupを本人のcf CLI認証で実行し、dry-run後に対象だけを撤去した。API認証値は出力・保存していない。

| 操作 | リソース | 実測結果 |
| --- | --- | --- |
| 削除 | Worker `itoma-demo-demo-path-isolation-check-98eb139cc452` | 1件削除、削除後の取得は404 |
| 削除 | Route `itoma-demo.kzk-maeda.com/demos/demo-path-isolation-check-98eb139cc452` と同パスの `/*` | 2件削除、取得一覧から消えたことを確認 |
| 保持 | 共通Worker `itoma-demo` と現存Gitブランチ15件のWorker | 同じWorker IDがすべて残ることを前後一覧で照合 |
| 更新 | 共通一覧Worker `itoma-demo` | [既存mainの一覧更新Actions](https://github.com/kzk-maeda/itoma/actions/runs/43695215920)で15環境の一覧を生成・配信、成功を確認 |
| 作成 | 上記更新のWorker Version | `a6dfb10e-f79d-47c6-809a-9e1b56c14e4a`。既存Workerの新versionで、別のWorkerではない |
| 変更なし | Custom Domain・DNS・Access Application/許可ポリシー・IdP | 更新・削除APIは呼び出していない |
| 新規作成なし | Worker・Route・Secret・トークン | 追加なし。上記の既存Worker更新のversionだけを作成 |

Worker数は **17→16**、対象zoneのRoute数は **32→30**。新しい定期回収処理の実API dry-runは `inspected=15, retained=15, results=[]` で、孤立候補が残らないことを確認した。匿名302は撤去検証の根拠に使っていない。ローカル原本はrepo内のGit管理外 `.tmp/qa/demo-cleanup-20261115/` に保存し、資格情報を含まない要約だけを本書へ記載する。

定期回収workflowのGitHub Actions上での実行はmainマージ後の確認事項。現存15環境を終了したい場合は対応するGitHubブランチを削除する。PRのmerge/closeやローカルブランチ削除だけでは撤去しない。
