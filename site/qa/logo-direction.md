# サイトのOPEN CIRCLEを左上の開きへ揃える

2026-11-20 JST / #253、アプリ側 #251 / PR #252と同じ本人指定。既存サイトPR #192のsource `2cf9b525a2d14d180131db14b58121f416a99ea0` を基点に修正。

## 調査範囲と変更

| 場所 | 箇所数 | 対応 |
| --- | --- | --- |
| トップのheader/footer、アプリ画面イメージ内のブランド | 3 | 左上の開き |
| privacyのheader/footer | 2 | 左上の開き |
| 404のheader/footer | 2 | 左上の開き |
| assets/site-mark.svg（全3ページのfavicon） | 1 | 左上の開き。半径13と余白を維持 |
| LP内の残量リング | 変更なし | 既に12時から時計回りの75%描画 |

半径15のロゴは `M20 5A15 15 0 1 1 5 20`、faviconは `M20 7A13 13 0 1 1 7 20`。同じ90度の開きを左上へ移す。サイトは本体のPNG/React部品を参照しないため、サイト内で全てを変更した。新しい外部画像参照や生成機構は追加しない。

[範囲監査](logo-direction.json)で、公開HTML/SVGの差分がロゴのパスだけであることを確認。本文、リンク、privacy案内、アプリ画面イメージの時間リング/文言、CSSの寸法・配色は不変。build script、Wrangler設定、workflow、Access guardも不変。rootのアプリコード/画像・nativeには差分を加えていない。

## 画面証跡

- [LP 390 Light](home-390.png) / [Dark](home-390-dark.png)、[1440 Light](home-1440.png) / [Dark](home-1440-dark.png)
- [privacy 390 Light](privacy-390.png) / [Dark](privacy-390-dark.png)、[1440 Light](privacy-1440.png) / [Dark](privacy-1440-dark.png)
- [404 390 Light](404-390.png) / [Dark](404-390-dark.png)、[1440 Light](404-1440.png) / [Dark](404-1440-dark.png)
- [favicon 16/32px](favicon-16-32.png)（実SVGをimgで表示した確認用画像。OS/ブラウザのタブ領域の撮影ではない）

再現用[capture.cjs.txt](capture.cjs.txt)を一時的な.cjsへコピーし、PlaywrightはNODE_PATHで渡す。サイト依存は追加しない。SITE_QA_BASEでローカルWranglerのポートを指定可能。画像はこの修正と同じソースのコミット前作業ツリーから撮影。

## 検証結果

- サイト既存7テスト・build・Wrangler dry-run PASS。
- ローカルWrangler（127.0.0.1:8797）で既存http-smokeを実行。テスト内の接続先ポートだけ一時的に置換し、privacy307、未知パス404、CSP/no-cache/nosniffをそのまま検査してPASS。
- 3ページ×4幅（320/390/768/1440）×2文字サイズ（100/200%）×Light/Darkの48条件 PASS。横overflowなし、pageerror 0、外部リクエスト0。
- footerのprivacy遷移/戻る/mailto、キーボードのskip操作も確認。モーション低減を有効にして撮影。
- 原則4・U07/U08、UI22/UI23/UI24/UI25に関連。字や色や操作は変更せず、装飾SVGは既存のaria-hiddenを維持。
- ルートの型/lint/Jest（29 suites / 280 tests）/demo tooling（32 tests）PASS。
- expo-doctorは外部取得失敗で18/20。サイトはExpo依存なし。native/Simulator/iOS VoiceOver/実際のブラウザfaviconキャッシュは未検証。

[ブラウザ結果](verification.json)。Linux Chromium155 / Node24 / siteのWrangler4.157.0。Wranglerの設定/ログの一時書込先だけXDG_CONFIG_HOME/WRANGLER_LOG_PATHで/tmpへ向けた。依存や本番の設定を回避・変更していない。

## 配信の境界

この修正はPR #192へ反映し、まだitoma.appへ再配信していない。既存の本人限定配信とAccessを維持。mainへの人間のマージ後、既存のサイト専用CIで反映する。一般公開、Access解除、認証/メールポリシーの変更は含めない。
