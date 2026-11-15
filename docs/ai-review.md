# OpenAI APIによるPRレビュー

`AI code review`は、OpenAI Responses APIにPR差分・周辺コード・base側の開発ルールと設計資料・対象SHAのGitHub check結果を渡す、読み取り専用のレビュー工程です。アプリのバックエンドは追加しません。

AIの指摘は参考情報です。通常CI、Simulator/実機QA、人間の承認を別に確認します。Workflowが成功しても「レビュー処理が完了した」だけで、指摘なしやマージ可能を保証しません。自動修正・自動マージは行いません。

次期の改善案は[Decisions APIでレビュー要否を選別する設計](ai-review-triage.md)を参照してください。PR作成時の自動ラベル・事前採点・以降の手動再実行は提案段階で、以下の現行手順にはまだ反映されていません。

## 初回設定

1. このWorkflowをmainへマージする。`pull_request_target`と手動起動はmain側の定義を使います。PR内のWorkflow変更だけでは新しいレビュー処理に切り替わりません。
2. GitHubの **Settings → Secrets and variables → Actions → Secrets** に、Repository Secret **`OPENAI_API_KEY`** を設定する。OpenAI APIを利用できるプロジェクトのキーを使用します。
3. 必要なら **Variables** に **`OPENAI_REVIEW_MODEL`** を設定する。既定値は`gpt-5.4`です。Responses API、Structured Outputs、`reasoning.effort: low`に対応するモデルを選びます。APIの利用権限・利用上限はOpenAI側で設定します。
4. リポジトリに`ai-review`ラベルを作成する。未作成の場合:

   ```bash
   gh label create ai-review --repo kzk-maeda/itoma \
     --description 'OpenAI APIによるPRレビューを有効化' --color 0E8A16
   ```

`GITHUB_TOKEN`はActionsが発行するものを使用し、追加のGitHub用Secretは不要です。組織側でActionsによるPRコメント投稿を禁止している場合は、投稿用ジョブの`pull-requests: write`を許可する必要があります。

## 実行手順

### ラベルで有効化

同一リポジトリからmainへ向けた、draftではないPRに`ai-review`を付けます。初回レビュー後も、そのラベルがある間はPRのpush、reopen、draftからreadyへの変更で再レビューします。同じPRの古い実行はキャンセルします。

ラベルを外すと以降の自動レビューを停止します。既に送信したAPIリクエストの課金は取り消せません。fork PR、draft、main以外へのPRは対象外です。

### 手動実行

Actions → **AI code review** → **Run workflow** で、ブランチに**main**、`pull_request_number`にPR番号を指定します。手動起動では`ai-review`ラベルは不要ですが、同一repo・main向け・open・draftでない、という条件は同じです。

```bash
gh workflow run ai-review.yml --repo kzk-maeda/itoma --ref main \
  -f pull_request_number=123
```

main以外を選んだ手動実行はスキップします。キー未設定、APIの認証・利用上限エラーは`failed`として記録されます。設定修正後に再実行します。

## 結果の確認

- PRの **AIコードレビュー** コメントを確認する。同じbotコメントを更新し、重要度P0〜P3、ファイル、LEFT/RIGHTの行、問題が発生する条件・根拠・修正案を表示します。コードリンクは対象SHAへ固定します。
- ActionsのJob summaryと、14日保持の`ai-review-<run_id>-<run_attempt>` artifactを確認する。`review.json`に対象head/base/差分のmerge base、モデル、response ID、トークン使用量、チェック結果、入力省略、構造化指摘を記録し、`review.md`に表示用の結果を保存します。
- `completed`はAPI応答と形式・位置の検証が完了した状態、`failed`はAPIエラー・拒否・打ち切り・不正な出力など、`skipped`は対象外または収集中の更新です。投稿直前にhead/base、ラベル、PR状態を再確認し、古くなった結果はPRへ投稿せず、artifactだけに残します。
- CLI起動前の失敗などでartifactを生成できなかった場合、投稿jobはスキップします。artifactがある場合はIDで受け渡すため、failed-jobsだけを再実行してもrun attemptの違いで名前がずれません。

CI結果は**収集時点**のcheck名・status・conclusionです。未完了・未実施を成功扱いしません。テストの生ログ、動画、端末画面をAIが検査する処理は含みません。過去のコメントは次の実行まで残るため、必ずコメント中のSHAを確認します。

## 入力範囲と上限

- 1〜100変更ファイルのPRが対象です。100件を超えるPRやテキスト差分がないPRは、未レビューのまま成功とせず失敗します。
- JSON入力は最大160,000 bytes。差分を優先し、周辺の変更ファイル本文は1件最大20,000 bytesで読みます。大きすぎる差分・バイナリ・取得できない本文などは、丸ごと省略して制約として表示します。GitHub側の差分打ち切りも検出して表示します。
- 変更ファイル内の直接のローカルimport（相対パス・`@/`）から最大6指定の関連コードをheadの固定SHAで読みます。依存グラフ全体や外部ライブラリは読み込みません。
- `AGENTS.md`、`docs/system/README.md`、UI/nativeに関係する設計資料、該当ディレクトリの`AGENTS.md`をbaseの固定SHAから取得します。ネストしたAGENTS探索は20パスまでです。提案と採用済み仕様を区別するよう指示しています。
- 実行1回につきAPIリクエストは1回、自動リトライなし、最大出力8,000 tokens（推論を含む）、API待機4分、レビューjob全体10分です。指摘は最大10件。上限は金額の固定を保証しないため、実際の使用量をartifactとOpenAIの利用状況で確認します。

## 実装・更新箇所

| 対象 | 正本 |
| --- | --- |
| 起動条件・権限・モデル既定値・Secret接続 | [ai-review.yml](../.github/workflows/ai-review.yml) |
| レビュー観点・日本語出力・根拠の要件 | [prompt.md](../.github/ai-review/prompt.md) |
| APIの構造化出力契約 | [schema.json](../.github/ai-review/schema.json) |
| 入力収集・API通信・位置検証・投稿前確認 | [ai-review.mjs](../scripts/lib/ai-review.mjs) |
| artifact・summaryの保存と終了コード | [CLI](../scripts/ai-review.mjs) |
| モックAPIによる回帰検証 | [ai-review.test.mjs](../tests/ai-review.test.mjs) |

追加依存のないNode.js 24のスクリプトです。OpenAI/GitHub APIのURLは固定し、モデルにツールやシェル実行権限を与えません。Secret付きjobで実行するコードとプロンプトはtrusted baseから取得し、PR側のソースや依存スクリプトを実行しません。入力するPR本文・ソース・文書は命令として扱わないように指示します。

実行コードは両jobとも`github.workflow_sha`、つまり実行中のWorkflow定義と同じコミットから取得します。PRイベントの`base.sha`には導入前の古いSHAが残る場合があるため、実行コードの取得には使用しません。レビュー対象のhead/baseや仕様資料の取得SHAとは別の値です。

API呼び出しjobはGitHub読み取り権限のみ、投稿jobはOpenAIキーを受け取らず、PRコメントの書き込み権限を持ちます。HTTPエラー本文、APIキー、生の入力全文はartifactやログへ保存しません。PRコード・文書・check情報がOpenAI APIへ送られることは、このレビュー処理の前提です。`store: false`を指定しますが、API側のデータ取り扱いは契約と設定に従います。

### `MODULE_NOT_FOUND` → `Artifact not found`の調査

まず`review`jobの最初の失敗を確認します。`scripts/ai-review.mjs`がない場合は、checkoutしたSHAにWorkflowとスクリプトが揃っているかを確認します。この起動失敗に続くartifact未生成は、その失敗の結果であり、OpenAI APIにはまだ到達していません。

Workflowの修正をmainへマージした後は、Actionsからmainを指定して**新しい手動実行**を起動するか、`ai-review`ラベルを付け直します。古いrunのRe-runは古いWorkflow定義を使うため、Workflow修正の確認には使いません。

Workflow、入力収集、出力契約を変えるときは、モックテストも更新します。

```bash
npm run test:ai-review
```

通常の`quality` CIでもこのコマンドを実行します。API通信、Secret未設定、出力検証、古いSHAの投稿抑止、PR状態の再確認をテストし、実APIの動作確認・課金結果とは分けて記録します。

## 公式資料

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [既定モデル GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)
