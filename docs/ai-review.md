# OpenAI APIによるPRレビュー

main向けPRの初回に`ai-review`を自動付与し、Decisions APIで影響を採点します。重要な変更・判定の不確実性・入力不足等がある場合だけ、既存のResponses APIによる本レビューへ進みます。

初回以降のpushは過去の結果をstaleにし、自動でAPIを呼び直しません。再実行はPRコメントの`/ai-review`、再判定は`/ai-review reassess`です。通常CI・人間の承認・Simulator/実機QAは別の工程です。

設計の理由・参考事例・採点の定義は[選別の設計](ai-review-triage.md)に集約しています。閾値は未校正の初期値です。モック検証と、実APIの利用可否・モデル精度・費用の検証を分けて記録します。

## 初回設定

1. 実装をmainへマージする。PRブランチのWorkflow変更だけでは、trusted mainの受付/実行処理は切り替わりません。
2. Settings → Secrets and variables → ActionsにRepository Secret **`OPENAI_API_KEY`** を設定する。Decisions APIの`gpt-6-luna`と、本レビュー用モデルを利用できるプロジェクトのキーを使います。
3. 本レビューのモデルはRepository Variable **`OPENAI_REVIEW_MODEL`** で指定する（例: `gpt-5.6-sol`、未設定時は`gpt-5.4`）。Responses API・Structured Outputs・`reasoning.effort: low`への対応が必要です。Decisions側はpolicyの`gpt-6-luna`を使用し、この変数を転用しません。
4. **`ai-review`** ラベルを用意する（既存repoでは作成済み）。初回ラベル付与にはprepare jobの`pull-requests: write`、コマンド受付から実行への接続には`actions: write`を使用します。追加PATやGitHub用Secretは不要です。

## 実行する

### 初回の自動判定

main向けPRの作成でラベルと初回状態を記録します。通常PRでは同じWorkflowの中で判定→必要時の本レビューへ接続します。GITHUB_TOKENで付けたラベルから別Workflowが起動することには依存しません。

- draftはラベルだけ付け、最初にreadyにした時点のSHAで1回だけ自動判定します。
- forkにもラベルは付きますが、OpenAIを呼ぶ対象は同一repo・open・非draftに限定します。
- 低スコアでもラベルは残します。ラベルがあることは、本レビュー実施・テスト成功・承認を意味しません。
- 導入前の既存PRをpush/reopenしただけでは、新たな初回枠を作りません。必要ならコメントで明示要求してください。

### PRコメントで本レビューを再実行

対象PRの**Conversationの新しいコメント**に、次の1行だけを投稿します。

```text
/ai-review
```

投稿者の現在のwrite/maintain/admin権限を確認した後、Decisionsを迂回して本レビューを1回実行します。ラベルがなければ付与するため、初回に低スコアで省略されたPRも対象にできます。fork/draft/対象外branch/巨大差分等の実行資格は迂回しません。

初回判定からやり直したい場合:

```text
/ai-review reassess
```

Decisionsを1回呼び、その結果に応じて本レビューします。どちらも権限のある人が**新しいコメント**で要求します。同じコメントの編集、引用、コードブロック、説明の併記、未知の引数では起動しません。通常Issueや差分上のinline review commentも対象外です。

### ラベルで要求/停止

人間が`ai-review`を追加・付け直すと、本レビューを1回要求します。既にラベルがある場合は一度外して付け直すか、コメントを使ってください。

ラベルを外すと現在の要求を取り消し、新しいAPI呼び出しや古い結果の投稿を抑止します。その後のpushではラベルを復活させません。既に送信されたAPIリクエストの課金は取り消せません。

### Re-runと保守用起動

課金する処理は、同じrunのRe-runでは再送しません。失敗後にAPIからやり直すときは、新しい`/ai-review`または`/ai-review reassess`コメントを投稿します。投稿jobだけの再実行は、元のartifact IDを使って結果を再利用します。

Actionsの手動起動は保守用に残しています。mainを選び、PR番号と`force`/`reassess`を指定します。comment IDを指定しない直接起動は、実際のactorのwrite権限を検証します。通常の再実行操作はPRコメントです。

## 結果を見る

PRの**AIレビュー**コメントには、修正候補と必要な次の操作を表示します。各指摘は優先度・コードへのリンク・発生条件/影響/修正方針で構成し、モデルの総評や重複する状態説明は載せません。修正候補がない場合も、確認できた範囲での結果と明示します。

未取得・不完全なテキスト差分があれば、人手で確認する対象を最大3ファイル表示し、残りの件数を案内します。画像・動画等は目視確認の件数を分けて表示します。周辺コードだけの取得制限も、完全な確認と誤認しないよう短く表示します。取得制約の解消にならない同じ入力での再実行を勧めず、分割または人手での確認につなげます。

コメント末尾の短い対象SHAリンクと**詳細・ログ**から、対象コミットとActionsを確認できます。採点内訳、モデル/ポリシー/要求情報、全省略ログ、モデルの未検証事項、収集時点のCI一覧はActions summaryと14日保持のartifactに残します。`review.json`はversion 2で、要求・判定・本レビューを分けて保存します。コメント内の機械可読状態も保持します。

たとえば、入力上限で3つのテキスト差分と4つの画像を確認できず、具体的な不具合を特定しなかった場合:

```text
AIレビュー

確認できた範囲では、修正候補は見つかりませんでした。

未確認・不完全な差分3ファイルは、人手でレビューしてください。
- （対象ファイルへのリンク3件）

画像・動画等4ファイルの差分は、目視で確認してください。

対象: 短いSHA · 詳細・ログ
```

省略、失敗、Draft待ち、更新による無効化も、実施済みの指摘0件とは別に表示します。再実行が必要な状態だけ、その状態に合うPRコメントのコマンドを案内します。修正候補を修正した後の再確認も、新しい`/ai-review`コメントで要求します。

| 状態 | 意味 |
| --- | --- |
| `claimed` | 要求を登録済み。処理中、または後続jobの起動失敗等で未完了 |
| `pending_draft` | 最初のready待ち。OpenAIは未実行 |
| `skipped_low` | 判定条件を下回ったため**本レビュー未実施** |
| `reviewed` | 本レビューの形式・指摘位置まで検証済み。PR承認ではない |
| `triage_failed` | キー未設定、認証/利用上限/通信エラー、不正な判定等。本レビューへ自動転送しない |
| `review_failed` | 本レビューのAPIエラー・拒否・打ち切り等 |
| `manual_required` | 100ファイル超、テキストなし、API再送禁止のRe-run等。分割/人間の確認/新しい要求が必要 |
| `stale` / `cancelled` / `unsupported` | 更新・取消・対象外等。古い結果を現在のレビューとして使わない |

結果にはhead/base SHA、元の要求者とコメントリンク、workflow SHA、policy version/hash、判定モデルと本レビューモデル、理由コード・軸別スコア・confidence・省略範囲を記録します。成功応答から取得できたusageとrequest/response IDも保存します。

CI結果は本レビューが収集した時点のcheck名・status・conclusionです。テストの生ログ、動画、画面をAIが検査する処理ではありません。指摘0件と、本レビュー未実施を区別してください。

## 判定ポリシーを更新する

正本は[triage-policy.json](../.github/ai-review/triage-policy.json)です。変更したPR自身にはtrusted workflow版の旧policyを適用します。

- 影響・範囲・重要境界を0〜4で採点。重みは0.40/0.30/0.30、100点へ換算した閾値は50。
- 重要パスはスコア下限70。rename前のパスも照合します。
- 最小confidence 0.70未満、高影響側の確率合計0.30以上、refusal/入力不足等は本レビュー対象へ昇格します。
- 不正な応答やAPI障害は判定失敗とし、0点で補完したり、全件本レビューへ送ったりしません。
- 低スコアは事故確率やマージの安全性を表しません。閾値は未校正と表示し、変更時はpolicy versionと評価結果を更新します。

判定factsは48 KiB、リクエスト全体は64 KiB、1要求1リクエスト、待機30秒、自動リトライなし。本レビューは入力160,000 bytes、最大出力8,000 tokens、待機4分の既存上限を維持します。これはitomaの上限で、APIサービス自体の上限値ではありません。

## 実装・保守箇所

| 対象 | 正本 |
| --- | --- |
| 初回・手動・取消のjob接続と権限 | [ai-review.yml](../.github/workflows/ai-review.yml) |
| コメント受付と認可後のdispatch | [ai-review-command.yml](../.github/workflows/ai-review-command.yml) |
| rubric・重み・閾値・重要パス | [triage-policy.json](../.github/ai-review/triage-policy.json) |
| 状態・要求・コメント認可 | [ai-review-requests.mjs](../scripts/lib/ai-review-requests.mjs) |
| 軽量収集・Decisions・数値検証 | [ai-review-triage.mjs](../scripts/lib/ai-review-triage.mjs) |
| 選別から本レビュー・投稿への接続 | [ai-review-pipeline.mjs](../scripts/lib/ai-review-pipeline.mjs) |
| PRコメントの修正候補・未確認範囲・次の操作 | [ai-review-comment.mjs](../scripts/lib/ai-review-comment.mjs) |
| 本レビューの観点・出力 | [prompt.md](../.github/ai-review/prompt.md)、[schema.json](../.github/ai-review/schema.json)、[実装](../scripts/lib/ai-review.mjs) |
| artifact/summary/終了コード | [実行CLI](../scripts/ai-review.mjs) |

追加依存のないNode.js 24で実装しています。実行コードは常に`github.workflow_sha`へ固定し、PRのコードを実行しません。受付/prepare/publishはOpenAIキーを持たず、API実行jobはGitHub読み取り権限だけを持ちます。

初回枠と要求のwatermarkは、botコメントの機械可読状態に保存します。コメント削除/破損から自動枠を未使用と推測しません。破損状態の自動修復はしません。運用者が過去runを確認し、破損コメントの撤去と新しい明示要求で復旧します。コメント削除は過去の重複排除情報も失うため、通常の停止はラベル削除で行います。

無関係なコメントは共有concurrencyへ入れず、受付後とAPI/投稿直前に元コメント・現在の投稿者権限・対象SHA・要求generationを再確認します。state更新とGitHub上のPR更新は原子的ではないため、分散的なexactly-onceを保証したとは扱いません。

HTTPエラー本文、APIキー、入力全文はログやartifactへ保存しません。PRのコードや文書をOpenAIへ送信することは本処理の前提です。本レビューは`store: false`を指定し、Decisionsには未対応のResponses用パラメータを送信しません。

## 検証・障害対応

```bash
npm run test:ai-review
```

通常のquality CIでも実行します。API・GitHubのモックによるルーティング/イベント/認可/重複排除/鮮度の検証であり、モデルの実際の精度検証ではありません。

実APIの利用可否、実PR30〜50件の人手による正解付け、取りこぼし/費用の測定、閾値の校正は[検証Issue #202](https://github.com/kzk-maeda/itoma/issues/202)で管理します。未校正の初期値を最適・実証済みと扱いません。

- `MODULE_NOT_FOUND`の後に`Artifact not found`が出たら、最初の失敗とcheckout SHAを確認する。Workflow修正後は古いrunをRe-runせず、新しいmainの実行を起動する。
- `claimed`のままならprepare後のjobを確認する。artifactがなければ投稿jobを起動せず元の失敗を残す。復旧後は新しいコメントを使う。
- `triage_failed`はDecisionsのキー/モデル利用可否/利用上限/応答形式を確認する。Responsesが利用可能なら、明示の`/ai-review`で判定を迂回できる。
- `AI review command`が`rejected`ならコメントの場所・本文・投稿者の権限・PRの実行資格を確認する。引用や編集で再送せず、新しい単独行コメントにする。

公式資料: [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)、[Decisions reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)、[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)。
