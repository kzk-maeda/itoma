# itoma.app — 正式サービスサイト

**2026-11-20時点は一般公開前の本人限定配信です。** `https://itoma.app/` 全体をCloudflare Accessで保護し、既存デモと独立した本人メール1件だけを許可します。一般公開への切替は別の明示依頼・レビューで行います。[リソース実績](../docs/cloudflare-resources.md) / [ADR0013](../docs/adr/0013-service-site-private-prelaunch.md)。

Expoアプリとdemoから独立した静的サイト。配信対象は `src/` とビルド生成ヘッダーだけです。`content/` とこのREADMEは配信しません。API・フォーム・JavaScript・独自解析はありません。

- `src/index.html`: 大枠の使い方、footerのポリシーリンク・メール窓口
- `src/privacy/index.html`: 正式ポリシー確定までの案内（正式な全文ではない）
- `src/404.html`: 不明なURLの404
- `src/assets/`: CSS、固定OPEN CIRCLE
- `content/privacy-decisions.md`: 採用事項・未決事項。#182を正本として追跡
- `scripts/build.mjs`: 出力を清掃し `dist/` へコピー。内部文案の差込欄混入を拒否
- `wrangler.jsonc`: 専用Worker `itoma-site` / Custom Domain `itoma.app`

## ブランドマークの向き

2026-11-20の本人指定（#251 / #252）に合わせ、サイトのOPEN CIRCLEも左上の開きに統一する（#253）。トップ・privacy・404のheader/footer、LPの画面イメージ内ロゴ、faviconの計8か所。ロゴは半径15、faviconは従来の余白を保つ半径13で、どちらも12時→右→下→左の270度の弧。残量リングの描画・レイアウト・色・本文は変更しない。

サイトは本体のPNG/React部品を直接参照しないため、ブランド変更時は`src/`内の全ページと`assets/site-mark.svg`を照合する。図形の向きの比較・範囲監査・ブラウザ確認は[QA記録](qa/logo-direction.md)を参照。

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
- main配信の前後に `npm run check:access` でトップ・privacy・資産・不明パスが、このサイト専用Accessログインへ302になることを確認。`npm run deploy` 自体にも同じチェックを組み込む。200/別の認証アプリ/DNS・TLS・通信失敗なら配信前に停止する。PRテストはmockを使い、本番サイトや本番secretへ接続しない
- demo workflowは従来どおり `demo/**` のみ。このサイトのPRや通常の作業ブランチではdemoも更新しない

既存のrepository secret `CLOUDFLARE_API_TOKEN` とvariable `CLOUDFLARE_ACCOUNT_ID` を使用。tokenには対象accountのWorkers Scripts編集と `itoma.app` zoneでCustom Domain設定に必要な権限が必要です。値をrepo・ログへ書かないでください。

対象accountの有効な `itoma.app` zone・既存DNS・メールを照合し、2026-11-20に本人依頼でAccessを先に作成、owner-onlyポリシーをAPIで読戻してから、ローカル認証で初回限定配信を実施しました。Worker `itoma-site` / Custom Domain `itoma.app` は作成済み。メールのMX/SPF、demoのAccess/IdP/Workerは変更していません。GitHub Secretの値や権限は読み出せず、Actionsからの初回配信は人間のマージ後に別途確認します。

人間がmainへマージした後もAccessは維持され、一般公開にはなりません。サイトworkflowの成功・配信Version・匿名302を確認します。認証後に `/`・`/privacy/`・実404・TLSを点検してください。guardは匿名リクエストの転送先を検証するだけなので、許可メール/Bypass等の権限監査を代替しません。許可ポリシーはCloudflare側で別管理します。

失敗時にguardを無効化したりAccessを外して再試行しないでください。古い成果物への復旧はAccessを保持し、既知の良好なサイトcommitへのrevert等で行います。DNSが未作成の初回bootstrap/完全撤去後の再構築だけはguardが通らないため、Access全ホスト設定とowner-onlyをAPIで確認→`npm run build`→`npx wrangler deploy`→匿名TLS/全パス302/代替URL無効を確認、という本人承認済みの限定手順にします。認証前のサイト本文表示を許容するbootstrapは行いません。

## 一般公開へ切り替えるとき

本人の明示依頼後に、公開本文・正式ポリシー・メール運用を確認し、チェックの変更をPRでレビューします。まず一般公開用のCIへ更新し、限定配信のまま内容/復旧手順を確定した後、**このサイト専用Accessアプリだけ**を解除する順序とします。デモのAccess/ポリシーやIdPは解除しません。解除後は匿名200/404/TLS/ヘッダーと代替URL無効を確認し、docsへ移行日時を記録します。本PRではこの切替を実施しません。

## 公開内容の状態

LPは公開用の実装ですが、アプリは配信準備中と表示し、App Storeリンクは捏造しません。画面は説明用イメージです。運営者と問い合わせ先は本人確定済みです。

プラポリは本人が「他は別途考える」としているため、未確定の原案全文を正式文として掲載しません。`/privacy/` には準備状況・確定済み窓口・配信事業者を案内し、正式配布前に#182の最新版と実態確認結果で本文を置換してください。この状態をApp Storeのポリシー要件達成として扱わないでください。

配信アカウント/Custom Domain接続、Access設定と匿名302は確認済み。メール認証後のサイト本文表示は本人報告でPASS。拒否メールの認証試験、support窓口の実受信/返信、VoiceOver・iOS実機は未実施です。初回はMacのDNSに未作成時の応答が残ったため、権威DNSのAを指定し実hostnameのTLS検証を保って匿名302を確認。標準DNSでのguard成功と混同しません。

Cloudflare参照: [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/) / [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)（2026-11-15確認）。
