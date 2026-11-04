# ITOMA Webデモ環境

ユーザーの明示的な依頼に基づくデモ配信のセットアップです。[ADRの提案PR](https://github.com/kzk-maeda/itoma/pull/29)の採用判断とは分けます。画面は現在のmainを基準とし、未マージの画面改善PRは含めません。

Cloudflareで作成したリソース・設定値・検証済み事項は [リソース一覧](cloudflare-resources.md) に記録しています。

## 閲覧

- URL: https://itoma-demo.kzk-maeda.com
- Cloudflare Accessのメール認証を使用します。初期はCloudflareにログイン中の本人メールのみ許可しています。
- ログイン画面で許可されたメールを入力し、届いたコードで認証してください。コードやセッションCookieを共有しないでください。
- 画面の選択・反映・キャンセルを試せます。実際のアプリ制限・保存・課金はありません。ブラウザを再読込するとメモリ内の選択は初期化されます。
- `/demo-build.json` に配信対象コミット・ビルド時刻・Webデモであることを記録します。このファイルも認証対象です。

## 構成

- Expoの既存Webを静的exportし、Cloudflare Workers Static Assetsで配信します。独自APIやDBはありません。
- `ITOMA_DEMO_BUILD=1` の場合だけ `web.output` を `static` にします。通常時は `app.json` の `server` 設定とiOS設定を引き継ぎます。
- `cf` とビルド委譲先のWranglerはdevDependenciesに版固定しています。Node.js 24 / `npm ci` を基準にします。
- `cloudflare.config.ts` はデモ専用Workerとカスタムドメインを指定し、`workers.dev` とversion preview URLを無効にします。
- Accessアプリはホスト全体を保護し、HTML・JS・CSS・画像・ビルド情報をまとめて認証対象にします。AccessポリシーはCloudflare側で管理し、メール・資格情報をソースに埋め込みません。
- ビルド成果物、`.cloudflare/`、`.wrangler/`、`.env` はGit管理外です。

## 更新手順

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test -- --ci --runInBand
```

レビュー対象の変更を作業ブランチにコミットし、作業ツリーをクリーンにしてから以下を実行します。

```bash
npm run demo:package
npx cf deploy --prebuilt --dry-run
npm run demo:deploy
```

`demo:deploy` はコミットと成果物の情報が一致することを確認してから配信します。HTMLや設定を変更したら再パッケージしてください。`cf`はbetaなので、更新時は別PRでビルド・配信互換性を確認します。現状、rootのpackage type未指定によるNodeの警告が出る場合がありますがビルドは可能です。

配信先アカウントが複数になった場合は、対象の `CLOUDFLARE_ACCOUNT_ID` を明示してください。ローカルでは `cf auth login` を使い、CI配信には最小権限の専用トークンを別途用意します。

## 閲覧者と保護の確認

Cloudflare OneのAccess Applicationsで `ITOMA demo` の許可ポリシーを編集します。メンバー追加は明示的な依頼に基づいて行い、メールドメイン全体の許可やBypassは追加しません。

認証のない別ブラウザやcurlで、`/`、`/demo-build.json`、実在するJS・画像URLがAccessのログインに転送されることを確認します。許可された本人のログインと操作は別途確認します。設定変更後も両方を確認してください。

## CIと復旧

CIは型チェック・lint・テストに加えて、資格情報なしの `demo:package` を実行します。外部配信は自動化せず、明示的な手動実行に限定します。アカウントの対話ログイン資格情報をGitHubへコピーしません。

更新に問題があれば、前回確認したコミットを別のクリーンな作業ツリーにチェックアウトし、同じ版の依存関係で再パッケージ・再配信します。デモ用コードをmainへ直接巻き戻す必要はありません。配信コミットとCloudflareのversion IDは検証記録に残します。

## 検証の限界

Webの操作確認は、iPhoneのScreen Time・バックグラウンド処理・署名・Family Controlsの実機検証ではありません。Dynamic Type、VoiceOver、ネイティブシートも別途確認が必要です。
閲覧制限があることと、アプリ内のデータが永続保存されることは無関係です。デモには個人の実データを入力しないでください。
