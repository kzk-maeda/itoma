# システム設計と意思決定

設計資料の入口です。確定した製品方針は [handover](../ITOMA_CODEX_HANDOVER.md)、UI判断は [DESIGN.md](../../DESIGN.md)、開発ルールは [AGENTS.md](../../AGENTS.md) を参照します。

画面実装の具体的な情報順・状態表示・操作・テーマ・部品契約は [UIガイドライン](../ui-guidelines.md)、検証は [UI受入条件](../ui-acceptance.md) を参照します。UI基準案は未採用のドメイン設計を自動採用せず、逆にデモの簡略化で制限・保存の仕様を上書きしません。

## 何をどこで管理するか

| 対象 | 正本 | 運用 |
| --- | --- | --- |
| 現在の仕様・モデル・責務 | このディレクトリ | PRでレビューし、コードと同時に更新 |
| 未決定の問い・調査・実装作業 | GitHub Issue | 比較案、受入条件、依存、阻害要因を記録 |
| 重要な判断理由と変更履歴 | [ADR](../adr/README.md) | 決定ごとに連番。変更は新ADRで置換 |
| 実機で確かめた結果 | 検証PRの証跡・[PoC記録](poc-plan.md) | SHA・ビルドID・端末/OS・観測日時を記載 |
| 進捗と優先度 | [ロードマップ #20](https://github.com/kzk-maeda/itoma/issues/20)・Issue | 資料内に進捗のコピーを作らない |

## 資料と検討Issue

- [MVPの利用シナリオ・範囲・解除体験を決定する](mvp.md) — https://github.com/kzk-maeda/itoma/issues/21
- [制限・解除・認可のドメインモデルと状態遷移を決定する](domain-model.md) — https://github.com/kzk-maeda/itoma/issues/22
- [時間帯・手動操作・一時解除の競合ルールを決定する](rules.md) — https://github.com/kzk-maeda/itoma/issues/23
- [React Native・Swift・Extensionの責務と更新プロトコルを決定する](architecture.md) — https://github.com/kzk-maeda/itoma/issues/24
- [ローカル保存・App Groups共有・プライバシー方針を決定する](data.md) — https://github.com/kzk-maeda/itoma/issues/25
- [Screen Time実機PoCの採否基準と検証手順を確定する](poc-plan.md) — https://github.com/kzk-maeda/itoma/issues/26
- [仮説検証用WebデモとCloudflare配信の方針案](../adr/0001-cloudflare-web-demo.md) — https://github.com/kzk-maeda/itoma/issues/28。Proposed。製品の仕様・OS動作を確定せず、配信前条件と分離時期を検討する。

## 着手から完了まで

1. 問いが既存Issueにあるか確認し、なければ「設計・意思決定」テンプレートで起票する。
2. 誰のどの操作を支えるか、選択肢、判断基準、必要なPoCを資料へ提案として書く。
3. 小さいPoCで不確実性を減らす。PoCは関連する検討と並行可能。署名変更・配布などの承認は別途必要。
4. 設計PRでIssueとADRを関連付け、人間が内容をレビューする。未決定事項を勝手に採用へ移さない。
5. 採用する資料とADRを同じPRで更新し、人間がmainにマージする。Issueに決定PRを残して閉じる。実装完了・実機合格とは分ける。
6. 実装Issueの設計前提が満たされたら着手する。前提が変わったら設計Issueを再開または新規作成し、ADRを置き換える。

技術的な選択の採用と、実機での検証済みは別軸です。ADRがAcceptedでもPoCが未実施なら保証しません。Issueが閉じているだけで設計採用とみなさず、マージされた決定PRを確認します。

## 本実装の設計比較

- [設定時間の累計・週月集計契約案](time-reflection-contract.md) / [ADR0007](../adr/0007-recorded-setting-time-reflection.md) — #96。Proposed。人間による採用前であり、#97〜#100の実装済み/Readyを意味しない。

[#22〜#25の設計レビュー](core-design-review.md) に、利用者回答・了承済みの7方針・比較・採用版に含むP1/P2修正をまとめています。個別仕様とADRはそこから参照してください。状態/ルールの表は実装するテストケースであり、実行済みの検証ではありません。

## 当面の順序

PR #36で状態・ルール・責務・保存の設計を採用しました。次は依存整合と純粋Swiftモデル/評価の単体テスト、並行して#8の環境確認と#26のPoC採否基準を進めます。その後、bridge/保存→認可・手動制限→Extension/予定登録→期限後再制限→解除体験と履歴へ進みます。進捗・依存は[ロードマップ #20](https://github.com/kzk-maeda/itoma/issues/20)、`Ready`等の運用は[開発フロー](../development-workflow.md)を参照します。

## 文書を更新するとき

- 提案・採用・棄却・検証状況を明記し、Issue・ADR・実装PRを相互リンクする。
- handoverは背景と過去の仮説を保持し、現在の詳細仕様はここへ集約する。矛盾はIssueで解消し、暗黙に上書きしない。
- OS/APIの挙動を決めるときは現行の公式資料と検証条件を記録する。外部記事だけで保証しない。
- 秘密情報、選択トークン、理由入力の実データを資料や証跡に残さない。

## 限定PoCの確認導線

- [Screen Time native runtime](screen-time-runtime.md) — #125。CNG/署名不要ビルドと、実機の署名・OS成立を分けた実装境界。

- [保存済み検証対象の表示と再制限](poc-saved-targets.md) — [#119](https://github.com/kzk-maeda/itoma/issues/119)。限定PoC提案。製品の再認可/再開仕様や実機合格を確定しない。
