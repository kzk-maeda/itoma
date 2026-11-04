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

## ビルド・配信

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

配信対象は既存の本人Cloudflareアカウントです。複数アカウントを使う場合は `CLOUDFLARE_ACCOUNT_ID` を明示します。CIは配信せずビルド・テストのみを実施し、CI用トークンは未登録です。

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
