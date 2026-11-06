# 全体配色の5案

状態: 視覚比較用の候補。デザイン原則のB案を土台に、同じ画面・動き・文言を全体配色だけ変えて比較する。ブランド色の採用や本体テーマの実装完了を意味しない。

## 開く

`demo/color-variations` を最新main `0bf54b3` から作成。ブランチのデモURLに次を付ける。

- `color-overview.html`: 5案を横並び/レスポンシブ表示。ライト・ダークを一括で切り替え、各案の操作画面へ進める。
- `design-colors.html`: 1案を操作しながら配色とシステム/ライト/ダークを切り替える。
- 例 `design-colors.html?palette=clay&appearance=dark`: 配色への直接リンク。指定できる値は既知のIDと表示モードだけ。不明値は基準配色/システムへ戻す。

ローカルは `python3 -m http.server 8768 --directory public`。各ページと共有JSは相対参照のため、既存のブランチ別base pathに収録できる。

## 候補

| ID | 名前 | 方向 | Lightの背景 / 主色 | Darkの背景 / 主色 |
| --- | --- | --- | --- | --- |
| forest | 苔と生成り | B案を引き継ぐ、自然体の静けさ | `#F6F5F0` / `#355C49` | `#171E1A` / `#BED1B8` |
| indigo | 霧と藍 | 澄んだ、静かな集中 | `#F1F4F7` / `#355574` | `#161D26` / `#AECDE8` |
| clay | 砂と珊瑚 | 親しみのある温かさ | `#FAF4EF` / `#925244` | `#241B18` / `#E9B29F` |
| violet | 藤と墨 | 穏やかさの中の小さな個性 | `#F5F2F8` / `#69517D` | `#201A27` / `#D3B9E8` |
| graphite | 墨と白 | 色数を抑え、余白と明暗を際立たせる | `#F4F3F0` / `#444842` | `#1B1C1A` / `#CDD2C4` |

各案はbackground/surface/text/muted/line/accent/soft/onAccent/目的面/線画の10役割をLight/Darkで定義する。色の正本は比較用の `public/color-palettes.js`。本体採用時は `src/constants/theme.ts` の意味トークンへ移し、別の本体テーマ体系を追加しない。

## 維持する体験

元は [#60 / 9aa89c3](https://github.com/kzk-maeda/itoma/blob/9aa89c3/public/design-motion.html)。別画面でアプリを選び、自分の言葉で理由を入力し、内容を確認する。円弧の補間・先端の点・目的のしおり・押下/遷移・Reduce Motionを維持する。

- 配色/表示モードの変更はCSS変数のみを更新し、入力・対象・command相当のデモ状態・解除期限を作り直さない。
- 選択は色だけでなくチェック/aria-pressedで示す。システムモードは表示設定の変更へ追随する。設定を保存する機能は追加しない。
- 比較ページのiframeは同じ操作画面のプレビュー。配色ごとに独立したデモ状態を持つ。外部サービスへの埋め込みではない。
- 主色を警告/解除成功の意味へ変えず、どの配色でも同じ意味と読む順番を保つ。

対応: 原則1〜5、U01/U02/U03/U04/U05/U06、UI23/UI30/UI31/UI33。色の候補としてP03/P08に接続するが、新しいブランド色を採用済みにはしない。

## 検証

`tests/demo-color-palettes.test.mjs` で10通り（5案×Light/Dark）の実際に使う文字色ペアを検証。本文は背景/面/選択面/引用面、補足は背景/面/状態ラベル面、主ボタン文字、選択文字、線画を含む。各モードでの最低値は次のとおり（4.5:1以上）。

| 配色 | Light最小 | Dark最小 |
| --- | --- | --- |
| forest | 4.65 | 5.92 |
| indigo | 4.69 | 5.80 |
| clay | 4.60 | 6.18 |
| violet | 4.58 | 6.01 |
| graphite | 4.63 | 5.88 |

装飾のlineを文字や必須の入力輪郭に使わず、意味を担う入力輪郭/選択はmuted/accentを使う。未操作の無効ボタンのopacityや装飾境界を上表の本文適合と混同しない。アプリ全体のアクセシビリティ適合宣言ではない。

Chromium / Playwrightで、10通りの適用、システムモード追随、配色変更後の理由/対象/期限の保持、選択対象だけの解除と早期終了、比較ページの5プレビューと表示モード/リンク、直接リンク、320/390/768/1200pxの横方向はみ出しなし、Reduce Motion、ブラウザ例外なしを確認。

品質チェック: 型チェック、lint、Jest既存2件、デモテスト（追加の配色テスト10件を含む）、expo-doctor 20/20、Webデモビルド。

画像: [5案Light](screenshots/color-variations/overview-light.png)、[5案Dark](screenshots/color-variations/overview-dark.png)、[苔と生成り](screenshots/color-variations/forest.png)、[霧と藍](screenshots/color-variations/indigo.png)、[砂と珊瑚](screenshots/color-variations/clay.png)、[藤と墨](screenshots/color-variations/violet.png)、[墨と白](screenshots/color-variations/graphite.png)。

## 範囲と未検証

元デモの一括5分・同時1セッション・200文字上限は検証用の簡略化を継承する。今回、製品の複数grant・保存・競合ルールは変更しない。実アプリ制限・起動・請求・理由の保存/送信は行わない。

iOS Simulator・iPhone実機・VoiceOver・Dynamic Type・ネイティブのキーボード/触覚・Screen Timeは未検証。今回のWeb配色比較を本体の動作証明や実機上の最終配色採用とは扱わない。既存デモ/共有インフラ/デプロイ条件は変更しない。
