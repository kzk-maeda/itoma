# 表示read・事実観測・制御復旧・保守の実行契約

状態: **Proposed / 設計と隔離追試のみ**。[#154](https://github.com/kzk-maeda/itoma/issues/154)、[ADR 0008](../adr/0008-control-read-recovery-maintenance.md)。人間のレビュー/mainマージ前であり、下表の新入口・job/tokenは提案上の名前。production実装、schema変更、実機の成立を宣言しない。

対象はmain `7642ebf657d97108e6825fef65dbe3a592a38625`。親[#150 F2/I1/I2](https://github.com/kzk-maeda/itoma/issues/150)の固定監査SHA `0c22b4b…`から、#151の初回設定追加までを再確認した。既存の[architecture](architecture.md)、[data](data.md)、[onboarding](onboarding.md)、[rule-details](rule-details.md)を置換する差分はADRに提案としてまとめる。

## 現行sourceと再現の範囲

| 現行入口 | 実際の動作・境界 |
| --- | --- |
| `useVisibleClock` | focused/active中の1秒表示clockと15秒ごとの`refresh`。JS hook自身はOS APIを呼ばないが、先はread専用でない |
| `ProductController.perform("snapshot")` | `observeEpoch`で認可取消を保存し得る。busyでなければ`refresh`をawaitし、その後snapshotを生成 |
| `refresh` | monitor prepare → `reconcile(recoverInterruptedCommands: true)` → monitor cleanup → History actorのimportをawait → 保護属性設定 |
| `snapshot` | control/unfinished grantsと現在contextを評価。rule-detailsはcontrol actor上で同期read。validUntil超過はunknownへ落とすが、現在は前段でreconcileする |
| `ProductRuleDetailsStore.read` | private open/quick_check/read/protectに加え、`prune(activeRuleIDs:)`を毎回実行。削除0件でもwriter TXを開始 |
| `performOnboarding("onboardingRead")` | private状態をread。selectionRefがあればcontrol open/認可epoch観測。submittedかつactivatedならprivate完了を回復し得る。`onboardingCanEdit`のactivation照会もwriter API内で実行 |
| `Reconciler` | Applyingと結果の新Evaluation IDで保存。無変更の同じcontextでもAdapter applyとsequence/reflection factを生成。これは現行の明示reconcileとして追試し、無条件skip修正はしない |

隔離[experiment](../../experiments/issue-154-read-lifecycle/README.md)は実sourceから`refresh`/private `read`のbodyを抽出して実packages＋fake portsで実行する。Appleの認可/Picker/ManagedSettingsやProductController全体はLinuxで実行していない。現行増幅の再現と将来の受入oracleを分け、理想化したhelperを本番fixとして提示しない。

## 操作matrix

「writeなし」はapplicationが要求する永続/OS/file属性の変更なしを指す。SQLite接続時のWAL/SHMやOSファイルI/Oの副作用まで証明するものではなく、read-only openを含む実装/実機確認が必要。

| 操作（提案名） | 所有者/実行条件 | 許される変更 | 結果・再試行・鮮度 |
| --- | --- | --- | --- |
| `readSnapshot` | host read port。表示/15秒poll/command結果再取得 | 既存controlと既存privateのread・純粋評価・DTO合成だけ。DB作成/移行、control sequence、fact、OS apply/register/cancel、private write/import/prune/protectなし | control as-of/sequence、private状態/revision、元の観測時刻/期限。busy/unknown/unavailableを返す。read再送可だが制御jobは作らない |
| `onboardingRead` | host-private read port | draft/binding/command/activation記録をread。書込TXを使わないread queryを用意。未確定candidate/完了処理を実行しない | independent onboarding revision、private availability token、`completionPending`等の状態。completedをOS成功としない |
| `observeFacts` | native lifecycle/context owner、Extension callback。認可/時計/zone/receipt発火等の新しい事実 | fact/取消epoch/Activation/失効の必要なcontrol保存、メモリの選択確認・preview無効化。新しい解除/候補実行なし | source identity/epoch＋observedAt。同じfactは冪等。保存失敗はunknownと未処理causeを保持し、観測済み否定事実を古い成功へ戻さない |
| `reconcileCurrent` | native coordinator/Extension。下のcauseを集約 | 現在policy/Activation/grant/receiptを再検証、Applying→own-store適用→結果/fact保存。必要なmonitor準備を別portで追跡。P1/P2の順序を維持 | 新しい証拠のみ新observation。失敗/不明は固定codeと原因を返す。同causeのpoll retryなし。現在の同期再評価中の境界越え補償は最大1回を維持 |
| `recoverInterrupted` | host startup/foregroundのnative coordinator。host実行中commandを除外できたときだけ | 残ったScheduling/ApplyingをUncertainへ。現在baselineを再評価。古いfailed grant/candidateの実行/attempt増加/期限延長なし | 明示retryが必要な結果を維持。callbackからhost recovery flagを使わない。SQLite CASは別processの新しいmarkerを守る |
| `confirmCurrentState` / explicit retry | 本人の確認/再試行操作→native command owner | 新apply/実readback、または既存の明示command retry。再試行は同command/grant identity・元期限で新attempt | 実際に取得したevidence種類と時刻を返す。確認ボタンで過去evidenceをtouchしない。readbackを伴わない成功を作らない |
| `maintainHistory` | host-private executor。起動/foreground/新outbox hint/明示retry | 1passはhistory ≤100、reflection ≤100。private commit後shared ack。本文なしjob状態と必要なgapを保存 | processed/pending/partial/unavailable/capacity/last-attemptを別表示。通常snapshotはawaitしない。ack失敗なら同event IDで再取込、削除cutoff維持 |
| `maintainMonitors` | native monitor owner。成功した現planと取消対象receiptがあるとき | current成功前提を再照合し、lock外で有界のobsolete予定取消と結果保存 | 取消不明は残す。期限保護のない新解除を許可せず、read要求で掃除しない |
| `pruneRuleDetails` | host-private executor＋host policy mutation coordinator。確定削除jobだけ | 下のrevision/削除ID条件でprivate DELETEとmetadata revisionを原子的更新。0件ならrevisionを進めない | 1pass ≤100 deleted IDs。staleなら無変更/再計画、失敗ならpending。private失敗はstop/reblockを止めない |
| `recoverOnboardingCompletion` | host-private executor＋host coordinator。submitted bindingのactivation記録を確認済み | private名前/目標とcompletedを同一TXへ。削除済みruleならdraftを完了扱いで退役。control/OS操作なし | CAS/重複実行で同じ結果。後発の明示空保存を保持。同じrule/command ID。unsubmitted/pendingを実行しない |

readは現在時刻で残時間/予定を表示できるが、現在のOS制限状態とは分ける。保存された旧applicationは時刻が進んでも同じrecordであり、期限切れやpolicy/zone/認可epoch不一致は表示上unknownになる。

## 原因の集約と再試行

native coordinatorはアプリ全体に1つ置く。画面ごとのfocus/pollはreadだけ。次のcauseを、`policyRevision + contextEpoch + boundary/registration identity + lifecycle activation ID`の必要部分で識別する。`contextEpoch`はcontrol/認可/時計のnative観測世代であり、#153のJS private epochとは異なる。JS request generationや単なる`Date.now()`をcause IDにしない。新しい本人intent/grant/registrationの変更は古いcallbackのkeyと区別する一方、coordinator自身のApplying/結果sequence更新を新しいcauseにしない。

| trigger | 必要な仕事・coalescing key | 失敗/重複時 |
| --- | --- | --- |
| 初回native startup / foreground | native認可/clock/zoneのsample→facts→現在reconcile。host command終了後だけinterrupted回収。1つのforeground activationに1cause | provider mount/focus/15秒pollと重複させない。処理中なら同じjobを共有、より新しいcontextはdirtyとして後続1passへ集約 |
| 認可の変更/確定取消epoch | statusとその観測identityでfactを先に保存し、preview/選択確認を無効化→必要なreconcile | Denied/Unknownから新しい解除なし。Approved復帰だけで再開せず既存の明示確認を維持。read要求に隠さない |
| timezone/壁時計の不連続 | native clock sample（壁時計＋monotonicの比較）/zone identityを変更として記録し再評価 | 古い時刻の観測を延命しない。rollback/zone復帰でgrant復活なし。JSが検知した差分はhintで、nativeが再sample |
| 予定開始/終了・grant実効期限 | DeviceActivity callbackのregistration ID/generation、native現在境界ID | 期限receiptの消費と論理失効を先に保存。旧/重複callbackも現在評価へ。新grant/candidateへ旧結果を適用しない |
| 観測validUntil超過/観測なし | current evaluation ID＋その期限で1cause。native foreground時/稼働中coordinatorが検知 | unknownへ落とす。元のevidence/期限のcauseを完了/失敗まで保持し、失敗結果の新Evaluation IDやvalidUntilなしを新causeにしない。初回の観測なしはstartup causeに統合。新境界/事実/foreground activationまたは明示確認で再試行 |
| 明示確認/復旧/停止/再開 | 新しい本人action ID、既存command ID/attempt | 同actionは共有/冪等。停止は制御優先。private maintenanceや別のread完了を必須待合せにしない |

状態は`idle → running(causes) → complete/failed/unknown`。running中の同keyはjoin、新keyは集合へ集約する。pass開始時のcontextと完了時のcontextが違えば新contextの1passだけ続ける。連続変化なら処理回数/時間の予算でyieldし、pending/unknownを保持する。具体的なnative時間予算は実機測定leafで決める。無限ループ、1画面ごとのjob、failed/unknownの15秒自動retryを作らない。

native serial actorだけを別processの排他/生存証明に使わない。durable command marker、policy revision/sequence CAS、receipt generationを最終TXで再検証する。host内の実行中commandがある間はrecoverInterruptedをdeferし、command完了後の最新状態へ統合する。readとmutationが交錯した場合、古いreadが新mutationの結果を取り消すことはなく、DTOの統合はcontrol sequenceと#153のprivate tokenで別々に行う。

JS clock停止・アプリbackground/killでも、登録済みOS予定→Extensionの同期callback→最新policy/grant評価→own-store再制限が独立して成立する必要がある。foreground coordinatorは欠落検知/復旧であり、JS timerの15秒周期を期限保証やcallback代替にしない。OS配信/実再制限は#50/#52/#131の実機ゲート。

## 観測と鮮度を延命しない

保存する証拠は`evaluationID / policyRevision / Activation / authorization epoch / zone / observedAt / validUntil / evidence`に対応付ける提案。readは元のobservedAt/validUntilを保つ。`validUntil <= now`、clockの逆行、認可/zone/policy不一致、Applying/failed/unknownは成功に見せない。clockや認可世代を永続tokenへ足す必要があれば後続leafでschema/互換性をレビューする。

新しいown-store readbackだけを行うportを追加するなら、最新planとの一致とcontextを実際に検査し、証拠ID/取得時刻/有限の次境界を保存する独立操作にする。`.writeAttempt`をreadbackへ昇格せず、own-store点観測をOS全体の連続遮断/正値時間へ昇格しない（ADR 0007のqualification gateを保持）。既存`apply`で証拠を得る明示reconcileは別のwrite操作として計測する。

## private read・取込・pruneの競合

rule-detailsはprivate executorで既存DBをreadし、control actorへ本文DBのopen/quick_check/pruneを載せない。control DTOを先に返せる合成方式または独立DTOを後続leafで選ぶ。private応答が未到着ならpending、読めなければunavailable。空の代替本文をreadyとして返さない。private readの失敗でstop/reblockを失敗させない。

#153の予定APIは共通`controlSnapshots` sessionの`beginRequest() → {epoch,generation}`、`integrate(snapshot,token)`、`invalidatePrivate()`、idempotentな`withControlSnapshots(client)`。両Provider/注入clientを同じsessionへ接続する。非同期private readは**開始前**に取得したtokenを配送まで保持し、完了時に新tokenを発行しない。background/再取得でepochが変わった旧ready/旧unavailableを両方向で捨て、新しい正規readでreadyへ戻る。availability順序にgeneration、本文上書きにmetadata revisionのhigh-waterを使う。古いgeneration/epochの応答でも、より高いdurable metadata revisionを示した場合はhigh-waterだけを上げる。旧応答の本文/availabilityは採用せず、現在表示中の本文がそのfloorより古ければ隠す。復旧は現在epochの適格なreadがfloor以上を取得したときだけ許す。control sequenceに私有情報の順序を代用させない。#153では最後のlifecycle consumerのdetachもprivate無効化/停止の境界とし、revisionのhigh-waterは保持する。snapshotをspread/JSON cloneするとWeakMapのprovenanceは引き継がれないため、非同期DTO分離では元tokenを明示的に`integrate`へ渡す。cloneだけで順序付きprivate本文を上書きしない。#153はnative fact/recovery coordinatorや自動mutation barrierを提供しない。

history importは各stream最大100件/1pass、shared batch取得→lock解放→private commit→lock解放→shared ackとする。既存event ID/sequence、source ID、削除cutoff/tombstoneを保持。copy成功前のack、削除後の再取込による復活を禁止。残量はpendingとして別jobに残す。制限回復を先に進め、private容量/lock/保護/破損で本文取込不能ならunavailable/gapを表示する。batch上限はSQL検査全体の計算量上限ではない。既存open検査/全件依存を#155の設計と計測へ渡す。全DBの`quick_check`/`integrity_check`は、この100件batch契約で小分割/有界になるとはしない。#155の独立した明示診断leafで全DBコスト・中断/進捗・専用executorを定義し、通常read/callbackやforegroundの必須復旧passへ戻さない。検査と修復/移行の実行も別にする。

pruneは次の**host所有の削除proof**を使う提案とする。

1. policy削除のcommit後、`deletedRuleIDs（最大100） / deletionPolicyRevision / expectedMetadataRevision`をjobへ渡す。古いactiveRuleIDs集合の補集合を使わない。readから削除jobを作らない。
2. host policy coordinatorはprepareの段階だけでなく、private TX開始直前に最新policyを再読取し、削除候補が存在しないことを検証する。全host policy作成/再導入・onboarding完了・metadata saveを同じmutation laneへ通し、**検証→private commitの間に当該IDを再導入/編集させない**。この区間はshared writerを保持しない。現行Extensionはpolicy作成を行わない前提を明記し、別processがpolicy writerになるならこの方式を使わずdurable cross-process tokenを再設計する。
3. private writer内でmetadata revision CASを検査し、検証済み削除IDだけを消す。既に後発metadata save/完了が進んだら無変更でstaleを返す。削除0件ならmetadata revisionを進めない。stale jobを最新revisionへ無条件リベースしない。
4. commit後にjob完了を記録。失敗/killなら同じIDで再照合し、重複削除はno-op。control再制限は待たない。jobが消失した場合の再発見は独立のbounded auditで最新policyとprivate IDを照合して行い、通常readに戻さない。

例: P1のactive集合を採取→P2で新rule Rと目標が保存→P1由来jobが遅着。P1/P2不一致とmetadata CASで無変更となり、Rは対象削除IDにも含まれない。単なる「後でactive IDsをもう一度読む」だけでは再読後/削除前の競合を防げないため、mutation laneの区間とprivate CASの両方が必要。

## Onboarding readと完了復旧

`onboardingRead`は保存draft/binding/submitted/command stateとactivation記録をreadし、「反映済み・private完了待ち」を示せる。起動/foregroundまたは明示の`recoverOnboardingCompletion`が次の復旧を依頼する。通常pollは実行しない。

- Prepareは安定draft UUIDをRule IDにし、command UUID/base revisionをprivateへ先に保存してから同じIDのcandidateを受理する。有効policyはまだ変えない。
- Commitは本人の最終確定により`submitted=true`をprivateへdurable保存してから既存commandを実行する。private保存失敗ならOS処理なし。read/coordinatorは`submitted=false`のcandidateを実行しない。
- bindingがsubmittedかつ同commandの`activatedCandidateRevision`があり、同Rule IDが最新policyに残る場合だけprivate完了を試す。policy revision番号だけで別commandのactivationを推測しない。Scheduling/Applyingの回収と、failed/uncertainの明示retryは別。
- 完了は名前/目標移送とcompleted/draft消去を同一private TXへ。onboarding revision CASを検査し、後発のmetadata/明示空行を上書きしない。privateだけ失敗ならbindingを保持して同じ処理だけ再試行し、OS commandを再実行しない。
- activated後にruleが削除済みならdraftを退役しcompletedにする。ruleを復活/再作成しない。未activatedなら結果/明示retryを表示する。Rule ID/command IDを新しく作らず、古いgrant期限/attemptも変えない。
- private失敗/遅延、readとcommit/discardの交錯は#153 tokenとonboarding revisionで古い応答を破棄する。認可sample/取消保存はobserveFactsへ移す。Picker/認可promptは本人操作のApple adapterに残す。

## portable host境界と受入

後続host serviceはclock/context、control read/command repository、private read/maintenance/completion port、monitor/deadline scheduler、RestrictionAdapter、identifier sourceを注入可能にする。Appleの認可/Pickerはadapter。Swiftの純粋評価/SQLite/command orderingをLinuxで追試し、Apple APIの呼出し結果はfakeとして記録する。

| ID | 入力・交錯 | 設計の合格条件 |
| --- | --- | --- |
| R01 | 同じcontextで10回/100回の表示read、focused clock稼働 | apply/register/cancel、control sequence/fact/private writer/import/prune/protect差分0。既存DBのみ。current sourceは未達 |
| R02 | 期限直前/同時/超過、旧policy/zone、clock逆行 | 元のobservedAt/validUntilを保持。expired/不一致はunknown。読取だけで期限を延長しない |
| R03 | 明示確認＋新しい実readback / apply、読取だけの再確認 | 新証拠を伴う操作だけ新しい観測。evidence種類/有限境界を検査、点観測で連続遮断を捏造しない |
| R04 | startup/focus/foreground/境界/expiry同時到着、進行中mutation | 同causeは1job、新contextは後続1pass。host実行中commandを中断扱いにしない。failed/unknown同causeのpoll retry 0 |
| R05 | Denied/Unknown、Approvedへ復帰、zone/clock変化、旧callback | 取消失効/最新baselineの必要評価を実行。明示再開/元期限を保持、grant復活なし。取消fact保存失敗はunknown |
| R06 | JS/表示clockを起動せずgrant期限callback | Extension経路だけで現在planへ再制限。Linux fakeと実機の期限結果を別記 |
| R07 | private取込blocked/capacity/corrupt/slow、readとstop同時 | read/control処理はprivate job完了をawaitしない。batch/lock分離、gap/pending、private commit前ack 0、削除cutoff復活0 |
| R08 | stale deletion P1→P2新rule/metadata、save/完了とprune交錯 | 新目標/明示空行を保持。policy lane＋metadata CAS、削除ID上限、0件revision増加0。失敗jobを勝手に完了にしない |
| R09 | 旧ready→新unavailable→旧ready遅着、逆順、新規read復旧 | #153と同sessionのtokenで古い配送を両方向に破棄。control新sequenceをprivate順序と混同しない |
| R10 | prepare前後、submitted保存前後、policy commit後private失敗、削除後再開 | 同Rule/command ID。unsubmitted実行0。activation照合後privateだけ復旧。明示clear/後発metadata保持、削除rule復活0 |
| R11 | read開始→mutation結果→旧read完了、privateだけ遅延/不可 | 新control/metadataを巻き戻さない。control read完了をprivate unavailableの成功へ変換しない。別providerで同token所有 |

現在のexperimentはR01の**増幅再現**、実Storageのread primitive/証拠不変、R06のfake callback、R10のprivate repository部分を実行する。trace checkerはR01〜R11の一部の違反を検出する設計oracleで、production adapter接続と全シナリオの回帰化は後続leafの完了条件。合成traceの合格をhost実装合格として数えない。

## 実装leafと完了条件

全leafは本ADR/設計の人間による採用・main反映を前提とし、現時点でReady/Accepted/実装済みとはしない。rootのIssue分割時にこの受入IDを引き継ぐ。L1は新read portを並設して検証できるが、既存product snapshotからrefreshを外す切替は、L2の必要triggerが同時に接続・検証できたPRで行う。L3の起動/復帰/新outbox job、L4の完了復旧も、旧read副作用を外す前に代替入口を接続する。分割PRの途中で期限/取消/完了の仕事を失う状態をmainへ入れない。

| leaf案 | 依存・所有変更 | 最小受入/証拠 |
| --- | --- | --- |
| L1: host read/private read port分離 | 本設計＋#153 main。read-only open/activation query、DTO合成、native fact入口との接続。architecture/data/rule-details差分を同PR | R01/R02/R09/R11。現行host入口で抽出なしのfake ports回帰。private blockedの間もread応答/stopが完了。新native buildの型/リンク |
| L2: native trigger coordinator/復旧入口 | L1と同時接続するか依存。coalescing key/state/clockと認可observations、explicit confirm。Extensionの既存契約を保持 | R03〜R06。同cause集約/unknown retry抑止/新cause回復/command交錯。境界越え/取消/旧callback。OS期限・killは実機ゲートに残す |
| L3: bounded private/monitor maintenanceと安全なprune | L1/L2、#153。deletion proof/mutation lane/CAS、batch/ack/status、data/rule-details差分 | R07/R08/R09。stale list/new goal、途中kill、private commit/ack failure、削除cutoff、上限と0件no-op。metadata/foreground遅延の計測 |
| L4: onboarding readとprivate完了回復分離 | L1/L2/L3のlaneと#153。onboarding差分、安定binding/activation query | R10/R11＋#151保存/再開の既存受入。submitted前適用0、activated後privateだけ再試行、後発clear/削除保持。Picker/保護は実機で別確認 |
| L5: 実機lifecycle/期限/保護/負荷の証拠 | L1〜L4を含むbuild、#49/#50/#52/#131と整合 | tested SHA/build/config/端末OS、clock停止/background/kill/取消/保護/最大データ/競合の時間と結果。Linux/Simulatorを実API成功へ数えない |

#155は終端payload/整合検査/生存集合の全件依存を扱う別設計であり、本設計のread分離だけで全制御計算量が有界になったとはしない。#152のnative no-opは独立。rootがIssue/PRの依存と共通indexの追加を管理し、この変更はproduction source、共通index、CIを変更しない。
