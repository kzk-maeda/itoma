# itoma.app — 正式サービスサイト

Expoアプリとdemoから独立した静的サイト。配信対象は `src/` とビルド生成ヘッダーだけです。`content/` とこのREADMEは配信しません。API・フォーム・JavaScript・独自解析はありません。

- `src/index.html`: 大枠の使い方、footerのポリシーリンク・メール窓口
- `src/privacy/index.html`: 正式ポリシー確定までの案内（正式な全文ではない）
- `src/404.html`: 不明なURLの404
- `src/assets/`: CSS、固定OPEN CIRCLE
- `content/privacy-decisions.md`: 採用事項・未決事項。#182を正本として追跡
- `scripts/build.mjs`: 出力を清掃し `dist/` へコピー。内部文案の差込欄混入を拒否
- `wrangler.jsonc`: 専用Worker `itoma-site` / Custom Domain `itoma.app`

## ローカル

Node 24推奨。アプリ側のnpm installやExpo exportは不要です。

```sh
cd site
npm ci
npm test
npm run preview
# http://127.0.0.1:8788/ と /privacy/
npm run check:deploy
```

`/privacy` は `/privacy/` へ正規化。未定義のURLには404を返し、SPAとしてトップへfallbackしません。HTML/CSSは更新ごとに再検証するCache-Control、CSP・Referrer-Policy等を適用します。外部フォントや解析埋込みを増やす場合はCSPと#182を見直してください。

## CI・Cloudflare

`.github/workflows/deploy-site.yml` が独立したNode環境で検証します。

- PR: `site/**` またはこのworkflowの変更でテストとWrangler dry-run。デプロイ・本番secret参照なし
- main push: サイトの `src/**` / `scripts/**` / package・lock / Wrangler設定 / このworkflowの変更だけで検証後デプロイ
- アプリコード・rootのpackage/lock・demo・site内ドキュメントだけの変更では本番配信しない。手動配信workflowなし
- mainの最新サイトソースとの照合と直列実行で古いbuildの上書きを防ぐ（後続がアプリだけのcommitなら配信を妨げない）
- demo workflowは従来どおり `demo/**` のみ。このサイトのPRや通常の作業ブランチではdemoも更新しない

既存のrepository secret `CLOUDFLARE_API_TOKEN` とvariable `CLOUDFLARE_ACCOUNT_ID` を使用。tokenには対象accountのWorkers Scripts編集と `itoma.app` zoneでCustom Domain設定に必要な権限が必要です。値をrepo・ログへ書かないでください。

初回配信の前提は、対象accountに `itoma.app` zoneがあり有効であること、必要権限があること、既存の同ドメインのWorker/DNS/Access設定と競合しないことです。別ホストのdemo用Accessは流用しません。Custom Domainはmainの配信時にWranglerが設定します。既存DNSの削除やネームサーバー変更はこのPRでは行いません。

人間がmainへマージした後、サイトworkflowの成功・配信Versionを確認し、未ログインで `/`・`/privacy/`・404・TLSを点検してください。失敗時はログを基に前提を修正し、サイト関連の修正commitで再配信します。既知の良好なサイトcommitへのrevertでも同じCIが動きます。

## 公開内容の状態

LPは公開用の実装ですが、アプリは配信準備中と表示し、App Storeリンクは捏造しません。画面は説明用イメージです。運営者と問い合わせ先は本人確定済みです。

プラポリは本人が「他は別途考える」としているため、未確定の原案全文を正式文として掲載しません。`/privacy/` には準備状況・確定済み窓口・配信事業者を案内し、正式配布前に#182の最新版と実態確認結果で本文を置換してください。この状態をApp Storeのポリシー要件達成として扱わないでください。

配信アカウント・ドメインの実接続、メール受信運用、VoiceOver・iOS実機は別検証です。

Cloudflare参照: [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/) / [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)（2026-11-15確認）。
