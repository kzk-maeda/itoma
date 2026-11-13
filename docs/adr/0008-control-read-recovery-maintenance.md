# 0008: 表示read・事実観測・制御復旧・private保守の寿命を分ける

- 状態: **Proposed**。設計レビュー・人間によるmainマージ前。実装済み/実機検証済みの宣言ではない
- 設計Issue: [#154](https://github.com/kzk-maeda/itoma/issues/154)、親 [#150 F2/I1/I2](https://github.com/kzk-maeda/itoma/issues/150)
- 対象main: `7642ebf657d97108e6825fef65dbe3a592a38625`（#151の初回設定を含む）
- 関連: [ADR 0005](0005-native-domain-and-mvvm.md)、[ADR 0006](0006-local-storage-and-history.md)、[ADR 0007](0007-recorded-setting-time-reflection.md)、#153（private応答の世代）、#155（生存/終端データ境界）
- 詳細: [control-read-lifecycle.md](../system/control-read-lifecycle.md)

## 問題と判断基準

現在の表示snapshotは、通常時にmonitor準備、interrupted command回収、own-store再適用、monitor整理、private履歴取込を待つ。private rule-detailsのreadもpruneのwriter transactionを開始する。#151の`onboardingRead`には認可epoch観測と、policy確定後のprivate完了復旧が含まれる。入口名だけをreadへ変えても副作用は消えない。

同一contextの表示回数でcontrol writer、OS Adapter呼出し、reflection fact、private仕事量が増える構造を解消したい。同時に、期限/認可取消/本当に不明な状態の再評価、古いcommandを再実行しない性質、期限を延長しない性質を守る。表示用timerやprivate DBの可用性を、再制限の前提にしない。

## 比較

| 案 | 評価 |
| --- | --- |
| pollの間隔だけを延ばす | 増幅は残り、表示頻度と制御が結び付いたまま。期限/不明の所有者も不明瞭 |
| 同じdesiredTargetsならreconcile自体を無条件skip | 同じ集合でも認可epoch、期限receipt、interrupted intent、証拠の期限が違う。必要な再制限と観測まで省略し得る |
| readで現在時刻を付け直し成功を延命 | 新しい証拠がなく、期限切れ/失敗を成功へ変えてしまうため不採用 |
| **read・事実観測・明示/イベント復旧・有界保守を分ける** | 所有者と再試行が明示できる。hostの調停、独立private応答、cleanupの競合契約が必要 |

## 提案する判断

1. `readSnapshot`と`onboardingRead`は、既存control/private情報と現在のclock/contextを読み、表示DTOを作る。control/OS/privateへのwrite、DB作成/移行/保護属性変更、import/prune、候補実行をしない。未準備/欠損/期限切れはその状態を返す。
2. 認可取消、時計/zone変更、callback等の事実はnative lifecycle/Extensionが独立入口で観測する。確定したnegative factの保存と現在planの再評価をreadの副作用へ隠さない。未保存なら不明を伝え、成功を推測しない。
3. 制御のreconcile/recoverはnativeが所有する。startup/foreground、認可/時計/zone、予定/解除境界、観測期限、明示確認を原因IDで集約する。無変更の表示pollは新しい原因を作らない。失敗/不明の同じ原因を15秒ごとに再実行しない。明示retryと新しい事実は許す。
4. 過去の観測の`observedAt`/`validUntil`をreadで更新しない。新しいapply/readbackの証拠、現在policy/Activation/認可epoch/zone/期限を検証したときだけ、新しい観測を保存する。readback専用portの追加は後続実装で決める。現行`RestrictionAdapter.apply`の証拠を単なるreadbackと呼び換えない。
5. private履歴取込/monitor cleanup/rule-details prune/private完了復旧は種類ごとの有界jobとする。通常readは待たない。private commit前にackしない、削除cutoffを越えない、shared/private writerを同時保持しない既存契約を維持する。
6. rule-detailsのpruneは、hostが直列化した**削除済みRule IDの有界リスト**と最新policy/metadata revisionの照合を使う。古いactiveRuleIDs全体の補集合を後から削除しない。private完了復旧は同じdraft Rule ID/command ID、`submitted=true`、activation記録を要求し、新しいrule/commandやOS操作を作らない。
7. private DTOは#153の同一JS sessionのrequest-start `{epoch,generation}`で統合する。control sequence、private metadata revision、availabilityの世代は別の軸。source分離だけで古い応答の採用を許さない。

## 既存資料への提案差分

このADRは現行Accepted契約を暗黙に上書きしない。採用後の実装leafが変更時に次を反映する。

- `architecture.md`: 「復帰時にsnapshotを読む」に、native lifecycleが先に事実観測/必要な復旧を要求することを追加。readはその完了を強制待合せせず、処理中/不明を返せる。既存のdurable intent、P1/P2、明示retry、Extension独立動作は保持。
- `data.md` / `rule-details.md`: 「次のhost readでprune/retry」を、独立private maintenanceへ置換。readは既存storeのみを読み、初期作成/移行/保護設定は明示open/bootstrapの責務へ移す。private commit→shared ack、削除cutoff、empty-row clearは保持。
- `onboarding.md`: 「次のreadで完了を再試行」を、readが完了待ちを表示し、native lifecycle/明示完了復旧がprivate bookkeepingを行う契約へ置換。未確定candidateをreadで実行しない既存性質を保持。
- schema変更は本設計だけで導入しない。cleanup/deletion tokenやread-only openの保存要件が必要なら、互換性/移行を後続PRで明示する。#155の全件走査/終端保持設計とは分ける。

## 検証と影響

[隔離experiment](../../experiments/issue-154-read-lifecycle/README.md)は現行hostのmethod bodyを一時packageへ抽出し、実際のControl/Storage/Historyへfake Apple/private portsを接続する。現行の増幅を期待する追試と、将来のtrace受入検査器を別に置く。受入検査器の自己テスト合格は、本番readが副作用なしになった証拠ではない。

分離後もreadのSQLが完全に有界/安価になるとは限らない。既存のopen検査/unfinishedGrantsの過去全件依存は#155に残る。実機のnative lifecycle配信、Screen Time予定、kill、App Groups、File Protection、最大負荷時の時間予算は別の実機ゲート。

## 採用後に分ける実装leaf

詳細の受入ID・依存は[設計の実装分割](../system/control-read-lifecycle.md#実装leafと完了条件)を使う。read-only host/private port、trigger coordinator、private maintenance/prune、初回設定完了復旧を個別レビューする。この設計PRだけでproduction read/writeやDB architectureを導入しない。
