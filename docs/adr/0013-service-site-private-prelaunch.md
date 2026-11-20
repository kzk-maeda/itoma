# 0013: 正式サイトを独立配信し、一般公開前は本人限定Accessで保護する

- 状態: Proposed（本人指定の限定セットアップは実施済み、恒久運用はPRレビュー対象）
- 検討Issue: [#191](https://github.com/kzk-maeda/itoma/issues/191)、正式ポリシーは[#182](https://github.com/kzk-maeda/itoma/issues/182)
- 決定PR: [#192](https://github.com/kzk-maeda/itoma/pull/192)
- 採用日: 未定（mainへの人間レビュー・マージ前）
- 関連ADR: [0001](0001-cloudflare-web-demo.md)。認証が必要なデモと正式サイトを別リソースで管理する
- 検証状況: 2026-11-20 JST、Cloudflare API設定・TLS/匿名拒否を確認。認証後の本文閲覧は本人報告PASS、拒否メール等は未検証

## 背景と解決する問い

本人は正式サイトのCloudflare準備を進めつつ、一般公開するまではZero Trust配下に置くよう指定した。PR192はmainのサイト変更だけで配信する構成だが、mainマージと匿名公開を同一の操作にするとこの指定に合わない。

## 選択肢と比較基準

| 案 | 評価 |
| --- | --- |
| 配信せずローカル確認のみ | 現状維持。実ドメイン/TLS/認証を確認できない |
| デモの配信先と許可ポリシーを共用 | 配信責務や将来のデモメンバー変更と結合する |
| 正式ドメインへ匿名公開 | 公開前の本人限定指定を満たさない |
| 正式ドメインへ独立配信し、専用Accessで本人だけ許可 | 今回の本人指定に沿う。公開への移行・Cookie/認証運用を別途管理する必要がある |

## 提案または決定

- `site/` の静的ファイルだけをWorker `itoma-site`、Custom Domain `itoma.app`へ配信する。Expo・demo・public/の出力を混ぜず、API/DB/フォーム/独自解析を追加しない。
- 配信前に専用self-hosted Accessアプリと独立した本人メール1件のallowポリシーを設定する。既存のメールOTP IdPは利用するが変更しない。Everyone/ドメイン一括/Bypassを追加しない。パスを限定せずホスト全体に適用する。
- `workers.dev`とVersion previewは無効。公開前のCI/通常ローカル配信は、配信前後にサイト専用Accessの302を確認し、公開コンテンツや不明な転送先・通信失敗では停止する。検証するのは匿名拒否であり、APIでの許可リスト確認の代替ではない。
- 初回は本人の明示依頼に従い、AccessをAPIで読戻した後に限定配信した。以後のmain配信は限定配信の更新であり、一般公開の承認を意味しない。mainマージは今回実行しない。
- 一般公開は別の明示依頼とPRで、公開本文/ポリシー/窓口を確認し、CIの公開前guardを変更してから、このサイト専用Accessアプリだけを解除する。デモの認証を外さない。

## 理由と影響

同じ公式URLで事前確認でき、公開時に別ドメインへ移す必要がない。専用ポリシーによりデモのメンバー変更から独立する。DNS/証明書はCustom Domainが管理し、既存メールのMX/SPFやネームサーバーは変えない。GitHub Actionsを使い、別のWorkers Builds/Pagesプロジェクトは作成しない。

Accessは認証Cookie等を使用し、Cloudflare側の認証処理/ログがある。Workerのobservability無効を「Cloudflareにログが一切ない」という説明にしない。公開時の実構成・保持等と正式ポリシーの確認は#182に残す。

## 証拠と未解決事項

設定IDと検証範囲は[リソース記録](../cloudflare-resources.md)、運用・復旧は[site/README](../../site/README.md)。匿名302/TLSと、本人認証後のサイト閲覧・拒否メールの試験・メール実受信/返信は別の検証にする。ローカルDNSに古い未作成応答が残った初回検査では、権威DNSのAを指定しhostnameの証明書を検証した。

GitHub Secretの存在は確認したが、値は取得していない。現行トークンの権限とmainからの初回Actions配信はマージ後に検証する。ローカルcf認証での配信成功をCI資格情報の成功へ転用しない。

公式資料: [Custom DomainとAccess](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[self-hosted Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)（2026-11-20確認）。

## 再検討条件

一般公開の本人依頼、閲覧メンバーの追加、ドメイン/許可ポリシーの変更、フォーム/解析導入、認証または配信失敗時に再検討する。配信を通すために認証を外す対応は行わない。
