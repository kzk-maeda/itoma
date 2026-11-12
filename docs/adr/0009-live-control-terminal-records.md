# 0009: live制御の正本を終端payloadから分離する

- 状態: **Proposed**。人間による設計レビュー待ち。schema変更・移行・削除・製品コードの実装はこのPRに含めない。
- 検討Issue: [#155](https://github.com/kzk-maeda/itoma/issues/155)、親 [#150](https://github.com/kzk-maeda/itoma/issues/150) F1/I3
- 決定PR: 未定
- 採用日: 未定
- 関連ADR: [0006](0006-local-storage-and-history.md) の共有/private境界と本人削除・非自動期間削除を維持する提案
- 検証: `7642ebf657d97108e6825fef65dbe3a592a38625` の実Storage/Controlを使うLinux合成入力の追試。実機・watchdog・移行は未検証。

## 背景と解決する問い

現在の`unfinishedGrants`だけでなく、`unreconciledGrants`、`endedGrantRegistrations`、復旧command選択も過去のJSONを読む。終了済みgrantのJSONだけが壊れても、現在policyの読取りは成功しつつstopはOS操作前に失敗する。callbackは同期終了の契約を既に持つが、この仕事量は過去の件数に依存する。openにはDB全体の`quick_check(1)`もある。本体のキャッシュ済みruntimeとExtensionの再openを同じ測定と扱わない。

索引で`reserved=1`だけを取得すると、現schemaが検出する「JSONでは未完了、flagだけ0」を見逃す。過去IDを消すと、古いrequestやstop/resumeを新しい操作として受理する危険もある。処理量を削る前に、完全性・冪等性・故障境界を決める必要がある。

## 選択肢と比較基準

| 案 | 制御負荷・完全性 | 故障・移行・プライバシー |
| --- | --- | --- |
| 現状維持 | 全JSON照合で隠れた予約も検出するが、過去総数に比例 | 過去JSON破損が現在制御へ伝播。追加移行なし |
| 既存flag索引だけ | 速いがflag/JSON不一致を隠す | 現在の完全性を弱めるため採用しない |
| 期間を決めて古いIDも削除 | 件数を減らす | 再送/古いcallbackの根拠を失い、非自動期間削除方針も変更するため採用しない |
| **型付きlifecycle正本＋live詳細＋終端ledger＋archive** | liveと未処理作業だけを読む。ID索引・ledger自体は増える | live JSONとterminal JSONの論理故障を分離。明示移行と全reader更新が必要 |
| 別DBへ直ちに全terminal移動 | 将来は構造障害も分離できる可能性 | 2DB atomicity/復旧/旧reader互換が増える。初回の必須条件にしない |

## 提案

[詳細契約](../system/live-control-retention.md)を提案する。

1. JSONから派生したflagを正本とせず、SQLの型付きlifecycle・予約・所有者・結果対応を正本にする。live詳細とheaderの双方向のdeferred FK/制約、単一writer、検証済みschema manifestにより、live詳細の欠落・孤立・二重予約を拒否する。payloadに独立した状態を残す場合は必ず正本と比較し、不一致を隔離対象のterminalと誤分類しない。
2. live集合に予約中だけでなく論理終了後のreblock待ち、復旧対象command、未解決登録/取消、使用中のowner/result/receipt/activated candidate証拠を含める。cleanupに残る登録はgrantがreconciledでもlive作業である。正本からの全live取得を予算超過時に切り詰めない。
3. 終端ledgerには再送拒否に必要なID、command種別/終了結果、command→grant対応、sticky end、期限、世代・登録identity、candidate採用事実を必要な間保持する。理由本文・native token・全文policyは持たない。終端再送APIは`alreadyFinal`を返し、新たな解除・resume・登録をしない。現行の「完全な旧grantを返す」APIからの変更は別leafでレビューする。
4. archived payloadは保持・本人削除の対象とするが、現在制御の入力にしない。archive確定/転送失敗は制限回復を待たせない。削除・圧縮の実装は別leafで、本人削除済みデータの再輸入も禁止する。ID ledgerに根拠のないTTLを設けない。
5. callbackのopenはheader/schema/live整合だけを検査し、全過去payload/全DB検査は明示maintenanceに分ける。型付きlive・DB構造の破損/容量不足は依然として制御を妨げ得る。自動初期化・古いsnapshotへの自動復帰・durable intentなしのOS操作は行わない。
6. callbackでは同期のdurable fire消費→現在評価→短いown-store操作→結果記録を完了する。時間切れ後もTaskがOS操作を続ける方式を採用しない。有界な固定コードの障害記録と起動時の復旧表示を別途設計する。

## 理由と影響

制御のpayload復号を`O(live + pending work)`へ寄せつつ、過去IDの点検索に`O(log terminal)`、索引/ledgerの保存・更新・チェックポイント費用が残る。DB全体の構造障害を防ぐ提案ではない。terminal JSON破損の隔離と、live owner/receipt不整合の拒否を同時に満たす必要がある。

旧schema6 readerは新版を拒否する。移行はhostの明示操作、schema切替は単一atomic commit、Extensionは移行せず未対応時に保守的に失敗する。同一リリースのhost/Extension更新と実機検証が前提で、旧Extensionが起動しないという推測を互換性の根拠にしない。実行中OS予定をcancel/延長して移行する案も含めない。

## 証拠と未解決事項

[再現方法・結果・限界](../../experiments/issue-155-control-retention/README.md)を参照。実際のpath依存パッケージを呼び、fixture以外に制御アルゴリズムをコピーしていない。SQL計測と小さい索引queryの下限を、新schema/Control実装の合格と解釈しない。

人間のレビューで、終端APIの互換性、live容量とadmission制限、archive配置と非削除の保証範囲、bounded telemetryの保存先/上限、iOSでのcallback予算を決める。具体的な依存leafと実装/実機ゲートは[詳細契約](../system/live-control-retention.md#依存する実装leafとゲート)に分ける。PC上の時間をiOS watchdog予算に転用しない。

## 再検討条件

live集合の完全性を定数個の有界な照会で守れない、旧Extensionへの切替が成立しない、ledger/DB構造の増大だけでcallback予算を超える、同期own-store処理が実機で短く完了しない、または保存方針の本人判断が変わる場合は、DB分割やプロトコルを再レビューする。
