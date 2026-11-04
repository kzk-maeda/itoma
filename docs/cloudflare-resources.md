# Cloudflare デモ環境の設定・リソース一覧

確認日: 2026-11-04（JST）。ユーザーの依頼で作成・配信したデモ用リソースです。ADRの採用判断とは別の、限定的なセットアップ・動作確認の記録です。
閲覧・更新手順は [demo-environment.md](demo-environment.md)、判断案は [ADR提案PR #29](https://github.com/kzk-maeda/itoma/pull/29) を参照してください。

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

## 設定した内容

- 閲覧URL: **https://itoma-demo.kzk-maeda.com**
- Accessは本人メールだけを許可。セッションは24時間、HTTP-only cookie有効、preflight bypassなし。
- Accessの許可メールの具体値はCloudflare上で管理する。メンバー追加時は明示的な依頼に基づきポリシーを変更する。
- Workerの `workers.dev` は無効。`https://itoma-demo.kzk-maeda0711.workers.dev` は閲覧用URLとして使わない。
- Version preview URLも無効。Custom Domain以外のURLによるAccess回避を防ぐ。
- Workerのcompatibility dateは `2026-11-01`。カスタムAPIコード・bindingsなし。
- 配信ファイルに `X-Robots-Tag: noindex, nofollow` を設定。検索除外は認証の代替にはしない。
- `/demo-build.json` にSHA・作業ツリーの状態・ビルド時刻・mock-onlyであることを記録し、キャッシュを無効化する。
- ローカルの資格情報を用いた明示的な手動デプロイのみ。GitHub Actionsには配信資格情報を登録せず、静的ビルドだけを追加した。

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

## 停止・削除・復旧

- 即時に閲覧を止めたい場合は、Accessで対象アプリの許可を停止し、必要なら既存セッションを失効する。Workerから先にAccessを外して公開状態にしない。
- 完全撤去は、WorkerのCustom Domain・Worker本体と残るVersionを確認して削除し、DNSの管理レコードが消えたことを確認してから、専用Accessアプリ・専用ポリシーを削除する。既存zone・Zero Trust組織・IdPは削除しない。
- 撤去操作は今回は未実施。実行前に対象IDを再確認し、改めて明示的な依頼に基づいて行う。
- 表示内容を戻す場合は、前回確認したコミットから再パッケージ・再配信する。元のAccess制御を維持し、反映後のSHAと匿名アクセスを再確認する。
- リソースが存在することと費用が発生しないことは同義ではない。今回、有料プランへの変更や課金設定の変更は行っていない。利用量・保持・課金条件の継続管理は残る。
