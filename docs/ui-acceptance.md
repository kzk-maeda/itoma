# UIの受入条件とレビュー手順

状態: **実装用テスト仕様案**。以下は将来実装・確認する条件であり、現在のUIの合格宣言ではありません。[原則](../DESIGN.md)・[UIガイドライン](ui-guidelines.md)と対で使います。

## 1. 条件表

U/Pはガイドラインの合意・提案ID。D/Rは[#36](https://github.com/kzk-maeda/itoma/pull/36)のドメイン/ルールテスト仕様であり、実装前に採用版のIDと再照合します。

| ID | 準備・操作 | 期待する表示・結果 | 主な検証層・対応 |
| --- | --- | --- | --- |
| UI01 | ルールなし→ホーム | 架空の円/制限なし。作成入口が見える | component・Web・Simulator / U01 |
| UI02 | 21:00–23:00、21:30、X/YouTube対象 | ルール名、円に90分/23:00、円弧75%、下部の重複時間バーなし | 表示計算unit・画像 / U05 |
| UI03 | 有効ルールが複数、異なる終了日時 | ルールごとに区別し、全体に単一終了時刻を付けない | fixture・component / P02 |
| UI04 | 一時解除入口→対象選択 | 共通入口1つ。X/YouTubeをどちらも選べる。初期未選択 | component・操作 / U02/U04、P01 |
| UI05 | 対象なし/理由なし/空白改行のみ/範囲外時間 | 確認不可。不足条件を文で表示。入力は消さない | unit・component / U03、R08 |
| UI06 | 自由入力→確認→編集へ戻る | 対象・全文・時間を保持。自動採点/補完なし | component / U03 |
| UI07 | dirtyな画面で戻る/gesture/継続を選ぶ | 破棄確認。入力継続なら保持、破棄承認ならgrant不変 | component・iOS操作 / D01 |
| UI08 | 入力中にアプリ切替→復帰 | draft保持。最新状態を再取得。OS強制終了後の復元とは分ける | Simulator・実機 / #36 |
| UI09 | X選択、YouTubeも制限中→確認/確定 | 対象・ルール・期間・理由と、YouTubeの制限継続を表示。Xだけ要求 | component・native・実機 / U04 |
| UI10 | 5分希望、2分後に優先ルール切替 | 最大2分/終了日時と理由を確定前に表示 | fixture・unit・native / R05 |
| UI11 | 確認中にruleVersion/revision/認可が変わる | 差分と再確認。旧条件で新grantを発行しない。draft保持 | component・native / D02 |
| UI12 | 確定を連打/画面を離れる/再表示 | 同commandの状況。期限・grant数が増えず、画面stackも増えない | component・native / D03/D11 |
| UI13 | Pending/Applying/Failed/Uncertainを個別注入 | 解除済みと断定しない。許可された再試行/状況確認が見える | fixture・native / D06/D09/D12 |
| UI14 | 5分解除から2分経過して再表示 | 同じeffectiveExpiresAtから約3分。新たな5分を始めない | 表示unit・native / D04 |
| UI15 | 期限到達、OS結果は未確認 | 期限終了/再制限中を表示。成功観測まで「制限に戻りました」としない | fixture・実機 / D05/D10 |
| UI16 | Xの早期終了、別アプリのgrantあり | Xだけを終了要求。別grantを暗黙終了しない | component・native・実機 |
| UI17 | 権限拒否/取消→再許可 | 設定保持。未適用を表示。本人の再開承認なしに自動適用しない | fixture・実機 / D08 |
| UI18 | 一時解除不可/同対象処理中の行 | 選べない理由と設定/状況入口。理由入力で迂回できない | component・native / R04 |
| UI19 | 23:00到達後も別の有効ルールあり | 全アプリ解放を推測せず、新snapshotに基づく対象と理由を表示 | fixture・native / R06 |
| UI20 | 日跨ぎ/現地時刻変化/観測が古い | 「翌02:00」等で日付が分かる。時差でgrantを延長しない。不明を隠さない | fixture・実機 / R01/R10 |
| UI21 | ルール編集を保存/取消/反映失敗 | 確定前の取消で旧設定不変。保存とOS適用結果を分け、失敗時に復旧可能 | component・native / D09 |
| UI22 | 長い日本語名・理由・最大文字拡大・320pt幅・キーボード | 読む/選ぶ/取消/確定へ到達可能。横スクロールや文字省略で重要情報が失われない | Web・Simulator・実機 |
| UI23 | Light/Dark、色に依存せず確認 | 文字4.5:1、意味のある非テキスト3:1。選択印・文言・状態付き | 色計算・画像・iOS |
| UI24 | VoiceOverで選択/入力/確認/戻る | 見出し→状態→入力→操作。選択・エラーを読める。フォーカス復帰。秒更新を反復通知しない | Simulator・実機 |
| UI25 | Reduce Motion/往復100回/画面離脱 | 不要な動きなし。表示timer/購読が残らずstackが増えない | component・計測・iOS / #36 |
| UI26 | 理由入力/取消/確定と証跡収集 | URL/ログ/解析/スクショへ実理由やtokenを出さない。取消本文を保存しない | code review・保存テスト / #25 |
| UI27 | 模擬金額モード表示/取消（採用時） | 実請求なしを確定前に表示。未合意の金額/理由条件を決めつけない | fixture・component |

## 2. テストの組立て

- 純粋表示テストは時刻を固定し、残時間・丸め・区間0/負値・1分未満・日跨ぎを表で検証する。OS効果のテストを兼ねない。
- componentテストはdraft保持・破棄確認・操作可否・イベントpayload・command結果の表示を検証する。スタイル値と同じ定数をassertするだけのテストを増やさない。
- fixtureは「未認可」「設定なし」「予定」「制限」「Active」「Pending」「Failed」「Uncertain」「再制限中」「複数ルール」を用意する。名前はUIの分類であり、OS API enumと誤認させない。
- 操作対象はrole/labelを優先。安定IDが必要なら `home-unlock-entry`, `unlock-target-<opaque-ui-key>`, `unlock-reason`, `unlock-review`, `unlock-submit`, `grant-status`, `grant-end`, `discard-keep`, `discard-confirm` を提案。理由本文・生token・アプリ名をIDに混ぜない。
- Web/画像比較は見た目・基本操作の証跡。iOSの戻るgesture、キーボード、Dynamic Type、VoiceOver、OS制限の証明に流用しない。
- 認可・適用・再制限の実効結果は変更を含むiPhoneビルドで記録する。native構成が異なる既存ビルドは `stale native build` とする。

## 3. 実装PRに記録すること

1. 対象U/P/UI ID、画面の利用場面、完了条件。P項目を採用する場合は決定PRをリンクする。
2. 依存する#36/ADRの採用版、変更されたモデルとUI差分。#36は6c17ac9で採用済み、UIの未採用P項目やPoCは区別する。
3. テーマの再利用・情報順・色/文字/余白の判断。デモから何を移し、何を除いたか。
4. 実行した条件IDとPASS/FAIL/未実施。対象SHA・bundle・native build ID/構成・端末/OS・観測日時。
5. Light/Dark・狭い幅・大きい文字・長い名前・キーボード・エラーの画像と、保存/取消/復旧の操作結果。
6. Simulatorと実機の結果を分ける。未検証は合格にしない。個人の理由・tokenを証跡に入れない。

## 4. この資料変更の検証範囲

今回の変更は原則・UI仕様・受入条件と開発入口の文書です。実行コード、デモ、OS設定、テーマ値は変更しません。表のUI01〜UI27は**未実装の受入条件**です。既存の品質コマンドが通っても、これらのUI条件やiOSの成立が検証済みになったことを意味しません。
