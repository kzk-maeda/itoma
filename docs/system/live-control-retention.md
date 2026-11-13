# live制御・終端記録・callback負荷の境界

状態: **Proposed**。[#155](https://github.com/kzk-maeda/itoma/issues/155) / [ADR 0009](../adr/0009-live-control-terminal-records.md)。設計レビューと限定benchmarkであり、schema移行・終端削除の実装ではない。現実装は`7642ebf657d97108e6825fef65dbe3a592a38625`。既存の[保存方針](data.md)・[durable操作順序](architecture.md)を暗黙に変更しない。

## 現在の実装と測定対象

| 現在のAPI/入口 | 現在の仕事 |
| --- | --- |
| `ControlRepository.unfinishedGrants()` | 全grantを配列化/JSON復号し、各owner command/intent/resultを照合してから予約を選ぶ |
| `ControlTransaction.unreconciledGrants()` | 全grantを復号しreconciledを除く |
| `endedGrantRegistrations()` | 全grantからendedを選び、全終了grantの登録を復号してobsoleteを除く |
| `commandsRequiringRecovery()` | 全command IDを取得して各command/intentを復号しscheduling/applyingを選ぶ |
| `ControlRepository.open()` | schema/application ID、全DB `quick_check(1)`、WAL、snapshotを検査 |
| optional reflection capture | 既存のreserved/JSON文字列prefilter索引＋最大101件で候補を選ぶ。これは完全なlive制御集合の正本ではなく、失敗はgapとしてbest effort処理 |
| host snapshot | キャッシュruntimeでsnapshot/unfinished grantを読む経路がある。通常refreshの副作用分離は[#154](https://github.com/kzk-maeda/itoma/issues/154)の対象 |
| `ScreenTimeRuntime.handleActivity()` | callbackごとにruntimeをopenしmakeService、同期reconcile、file保護。catchは現在無記録 |

`observedTransaction`、`recordCurrentFacts`、protection確認、settlementも複数回これらを呼ぶ。1回だけの索引化ではstop/callback全体の過去依存を取り除けない。Extensionは既に`reconcileSynchronously`を使う。[Extension bridge](../../extensions/ItomaActivityMonitor/ItomaActivityMonitor.swift)はactor仕事の終了を待つ。callbackの外側に100msのbusy timeoutがあっても、総処理時間やwriter保持の上限ではない。

## 提案する正本とlive集合

これはschemaの役割/制約案であり、DDL確定版ではない。

- `grant_headers`：grant ID、owner command ID、target、occurrence identity、accepted/initial/effective expiry、sticky ended、canonical lifecycle、latest generation/registration参照。状態を決める正本で、terminal JSON内のstatusを状態判定に使わない。
- `command_headers`：command ID、kind、attempt、canonical status、expected/candidate revision、reasonRef、result grant ID、最新activation操作との関係。未解決commandのみの部分索引を持つ。
- `live_grants` / `live_commands`：現在の意味検査に必要なtyped詳細。live headerのIDを参照し、headerからもlive詳細のIDを参照する双方向のdeferred FKを使う。terminal headerはlive-detail keyを持てないCHECKを設ける。片側だけの移動をcommitさせない。
- `live_registrations` / `pending_cleanup`：登録準備・結果不明・発火・取消未完了と、現在の保護に使うreceipt/世代/owner/candidate採用証拠。live grantがreconciledでも取消未解決なら残す。
- `terminal ledger`：正本headerを圧縮した終端identity/結果の索引。archive payloadとは別責務。古いIDの点検索とcallback判定のため保持する。
- `terminal archive`：過去の全文intent/attempt/registration snapshot等。保持・本人削除・必要な閲覧/maintenanceに使う。Extension/current評価は読まない。private本文やtokenの保存範囲を増やさない。

live取得の定義は次の和集合の推移的な参照閉包とする。

| 集合 | 含めるもの・除外条件 |
| --- | --- |
| G: 現在grant | pending/scheduling/applying/active、未終了のuncertain/failed予約、expired/invalidated/reblockPendingおよび終了後uncertain/failedで現在storeのreblock未確定。`reserved=1`だけに限定しない |
| C: 未解決command | scheduling/applyingの復旧対象、pending実行、明示retry可能なfailed/uncertain、未採用candidate、最新stop/resume操作、G/Rに必要な所有者。参照されるsucceeded commandも含む |
| R: 登録/取消 | Gを保護する登録、準備中/unknownの登録、未解決取消、未処理fire。obsoleteの古い世代はledger参照へ移せるが、古いregister応答がまだ到着し得るものは移せない |
| E: 適用/採用証拠 | 最新Applying/Applied/Uncertain evaluation、activation operation ID、live receiptを正当化するactivated candidate revision、current/last-valid policyと未解決candidateが参照するselectionの閉包 |

参照されるterminal ownerを毎回archiveから復号しない。Cの型付き小さい参照証拠またはledgerから供給する。candidateが失敗状態でも、既に希望policyとして有効になったなら、その採用事実とreceiptを消さない。joined requestの`command→grant`対応はownerと別に保持する。

現行`loadSnapshot`はimmutable selectionを全件読むため、過去selection追加も別の増加要因になる。Eのselection取得も参照閉包とその完全性検査へ置換する必要がある。必須参照は有効ruleとlive操作が要求する範囲で、現行が許すdisabled ruleの未設定selectionを新たに義務化しない。未参照token payloadの保存先/保持は別leafで明示し、このPRで削除しない。今回のbenchmarkはselection数を固定しており、この増加要因や巨大policyの時間上限を測ったものではない。

## 完全性の不変条件

1. **lifecycleの正本は一つ**。live/terminalの分類は型付きheaderで決定し、JSONの別状態や派生`reserved`を入力にしない。移行時に全legacy payloadを照合する。以後のpayload状態は正本から再構成するか、読んだlive payloadと比較して不一致を拒否する。
2. **live headerと詳細の全単射**。headerのcanonical lifecycleがliveなら同IDのlive詳細を必須にし、live詳細の参照先headerもliveでなければならない。CHECK＋双方向deferred FK/同等のcommit時制約を設ける。live詳細だけを消す/terminalへ移す更新は失敗する。どちらか一方向のFKだけでは完全性を主張しない。
3. **予約は現在集合の制約**。予約し得るlifecycleとtargetのUNIQUE部分索引を正本に設ける。sticky endedは戻せず、初期期限不変・実効期限単調短縮、最新generation単調増加をwriterで照合する。grantのowner、全joined結果、occurrence、対象が一致し、欠けた参照を「grantなし」にしない。
4. **receiptの閉包**。現在のactive/applyingを許可するには、live grantと最新登録identity/generation、正確な期限、receiptの受理時刻/未発火、owner attempt、採用済みcandidate、現在revisionの関係が必要。receiptだけあっても未採用candidateを有効化しない。
5. **未処理作業をterminalへ隠さない**。reblockまたは取消/登録結果が未確定ならGまたはRへ残す。終了事実と現在store再制限の確認、OS登録の取消結果は別の事実である。`retired=1`だけで移動しない。
6. **すべて単一writerで更新**。accept/receipt/CAS/negative fact/fire/terminal化と関係するheader/詳細/result/cleanupを同じTXで変更する。schema/index/FK/triggerのmanifestをopenとTXで検証する。残存する旧connectionもuser_version再確認後にだけ書ける。
7. **取得は全liveか失敗**。indexed live header→詳細のjoinと、live詳細→headerの逆検査、R/Cの閉包を同一read snapshotで検査する。0件を正常空集合と判断する前にも単射/参照条件を確認する。LIMITで超過分を落としてOS適用しない。全DB `foreign_key_check`や全terminal照合を各callbackの代用にしない。

この契約で防ぐのは、対応writerの中断/実装不整合や検出可能なlive破損である。任意のディスク改変が正本と制約の両方を整合的に書き換えた場合を、過去を読まず検出できるとは主張しない。SQLiteの索引/page破損も別の構造障害である。現schemaのflagをそのままcanonicalと呼び替える変更ではこの条件を満たさない。

## 終端ledgerと再送

| 参照中のcompact summaryに残す情報 | 理由・削れない条件 |
| --- | --- |
| command ID、kind、final disposition、attempt high-water、終了/解決sequence | 古いIDを新規として扱わない。同ID別kind/再試行を拒否。failed/uncertainでretry可能ならまだlive |
| command→result grant ID（joined commandも含む） | 古い受理結果を別grantへ解決しない。ownerだけの保存では不足 |
| grant ID、owner、target/occurrence identity、acceptedAt、initial/effective expiry、sticky ended、終了reason/sequence | 期限延長/復活/別対象への転用を拒否し、古いendを正確に旧grantへ対応させる |
| registration ID、grant/owner ID、generation、scheduledFor、fired/obsolete fact、必要なreceipt acceptance | 古いcallback/遅れたregister応答の同一性判定。未解決取消・receiptはliveに残る |
| activated candidateのcommand ID / adopted revision | live grantのreceiptがそのcandidateに由来する間は必須。終端候補を再採用しない証拠 |
| 最新activation command ID、policy revision、snapshot sequenceのhigh-water | 古いstop/resumeと古いApplying markerによる上書きを拒否。現在state側に保持 |

上記をすべて各tombstoneへ重複保存する必要はない。IDで参照されるcompact typed ledgerへ正規化する。全文policy/全attempt/理由本文/native tokenはcompact ledgerの必須情報ではない。monitor名の世代は使い回さず、既知終端登録の詳細をarchiveから読んでcallbackを再実行しない。

G/C/Rからの参照と遅延応答がすべて閉じ、新しい終端API契約も採用された後の**最小identity tombstone**は、command ID/kind/final outcome/result grant ID、grant ID/owner/sticky ended、消費済みregistration ID/generationの対応まで縮める案とする。target/occurrence/期限/receipt/activated candidateの詳細は参照中の意味検査と過去記録に必要な情報であり、すべてを永久にhot ledgerへ重複する必要はない。詳細はarchiveへ保持し、live参照が残る間は決して外さない。最新activation操作/revision/sequenceは現在stateで維持する。終端IDそれ自体の忘却や再利用を、この縮約に含めない。

終端IDの受理は新しいAPI結果`alreadyFinal(kind, outcome, resultGrantID?)`または明示的な`terminalID`拒否を返す提案とする。**現行`GrantAcceptance`の完全な旧grant/intentを返す互換性を保証する提案ではない**。完全な旧intentの構造一致を引き続きAPI契約にする場合、全文policyを含む証拠の保存/別照会が必要になりcompact性を失う。ここは実装前のレビュー項目。どちらの結果型でも終端IDの再送にOS操作・fresh candidate採用・grant生成・resumeを伴わせない。

古いcallbackは登録ID/世代を点検索し、liveの一致した未消費fireだけをdurable消費する。unknown/終端/別世代は現在状態の再評価だけを要求できる。古いreceipt/古い候補のplanを適用しない。旧grantへのendやstopを再送しても、新しいgrant/最新resumeを変更しない。

## 保持とarchive

自動期間削除なし・本人削除・容量警告/新規payload停止というADR 0006の方針を維持する。今回、期間削除/新しい保持期限を導入しない。終端JSONをhot pathから外すことと本人の過去記録を消すことを同一視しない。

初回の実装leafは同一DBのterminal archive保持までに限定できる。その場合、JSONの論理破損は隔離できても、同一DBのpage/index/媒体故障と容量増大は共有する。別ファイルへ移す場合は後続leafで、immutable event identity/sequence、archive durable commit→shared ack、本人削除cutoff、再実行、容量不足、未ack保持を定義する。archive移送が完了しないだけでreblock/stopを止めず、履歴欠損は明示する。control自体の容量不足を成功扱いにしない。

ledgerを根拠のないTTLで消さない。新DBへの完全初期化やID namespace/epoch切替が旧callbackと衝突しないことまでレビューされるまでは、本人の履歴本文削除後も必要なidentityを残す。SQLiteファイル、WAL、索引、checkpoint、移行用shadow/backupは別々に容量計測する。

## open・検査・故障境界

| 故障/検査 | callback/current pathの提案 | 明示maintenance/復旧 |
| --- | --- | --- |
| archiveのterminal JSONだけ不正 | archiveを読まず現在制御を継続。known terminal IDはledgerで拒否 | payloadを隔離、記録欠損を表示。本文をログへ出さない |
| live payload/header・owner/result・receipt/generationの不整合 | corrupted/uncertainを返し、推測planや新規解除を適用しない | 原本を維持して診断。本人の復旧選択へ。最後の旧planを自動復活させない |
| schema/application ID/必要な制約が不一致 | 未対応/誤DBとして停止。Extensionは移行しない | 同一版のhostで明示移行/診断 |
| SQLite page/index/WAL構造破損 | 軽量openを通過しても必要pageアクセスで失敗し得る。OS結果はunknown | 全DB `quick_check`/必要に応じ`integrity_check`を明示実施。検出/診断は制御成功を保証しない |
| busy / protected / full / I/O failure | typed分類、durable intent/既存own-storeを維持。短い有限回数の試行で終了 | lock競合/初回unlock/容量/共有containerを診断。自動空DB作成なし |

軽量openはSQLite open、schema/app ID/WAL、検証済みmanifest、現在snapshotとlive閉包を検査する。`quick_check`省略はDB健全性の保証を強める変更ではない。過去検査は#154のexplicit maintenance境界と揃えるが、**全DBのquick_check/integrity_checkは100件batchで有界に分割できるjobではない**。重い整合診断は独立したレビュー対象leaf/明示jobに分け、callback/read/必須foreground復旧passに入れない。`quick_check(1)`も全DBの読み仕事を持ち、JSON意味検査ではない。terminal payloadだけ不正なfixtureでは現在openが成功することと区別する。

OS操作前のdurable intent/Applying commit、最終writer内の現在事実再検証、結果commitを保つ。現在DBを開けない/書けないとき、停止のためと称してdurable intentを省きown-storeをclearする変更はこの提案に含めない。OS操作後の結果保存失敗はUncertainでありDB rollbackをOS rollbackと表示しない。

## 移行・旧reader・中断

1. hostだけがschema6→新schemaへの明示移行を行う。Extensionは読取/書込の対応範囲を確認し、未対応版ではOS変更をしない。新版hostとExtensionを同一native buildへ含める。schema6 readerが新版を拒否する既存動作を互換性の一部として試験する。
2. 移行準備はcanonical snapshotと全legacy command/grant/registration/result/candidateを照合する。現時点でしか分類できないflag/JSON不一致やlive receipt不整合を拒否する。曖昧な旧grantをterminal扱いして進めない。旧ID/sequence/generation/期限/採用事実を維持し、適用成功やreceiptを捏造しない。
3. terminal JSON破損のある旧DBを軽量経路だけで安全に分類できるとは主張しない。移行失敗として旧DBを保存し、明示診断へ回す。terminalのidentity/状態を別証拠で確定できる修復は別のレビュー対象。
4. 最初の実装はschema変更とbackfillを単一SQLite writer TXで行い、最後に`user_version`を切替える。kill/full/constraint失敗は全rollbackし、旧readerが読める旧schemaを維持する。OS登録/cancel/clearを移行TXから呼ばない。長いwriter保持が発生するため、移行の所要時間/lockとcallback競合を測ってから公開する。
5. 大規模DBでshadow/backfillの分割が必要になったら、host-only staging DB＋source sequence照合＋変更catch-up＋短い最終切替を別途設計する。無検証のchunk migrationや二重writerを導入しない。migration中も古いschemaでcallbackを継続できる案の安全性を先にレビューする。
6. commit前に中断→旧schema再open、commit後に中断→新版再open/冪等な完了確認を試験する。commit後に旧ファイルを復元する自動rollbackは、新しいstop/receipt/fireを失うため禁止する。修正は新版forward migrationを基本とし、本人復旧であってもOS状態を推定して戻さない。

本体UIを見ていること、JS稼働、private履歴の取込成功を制限回復の前提にしない。旧Extensionが対応しない更新区間は制限回復の遅れになり得るため、#49/#50/#52/#131の同一native build/旧callback/kill試験を移行公開のゲートにする。

## callbackの有界性と障害観測

仕事量は`O(G + C + R + policy/targets + bounded outbox work)`、過去ledgerの点検索は`O(log T)`を目標にする。全grant/command/obsolete registration列挙、全DB検査、archive復号、private importをcallbackへ残さない。複数回のcurrent facts再検査を、過去の全配列の再生成で実装しない。callbackは新規予定登録・明示retry・candidate採用を始めない。

現行のhostのtoken50件guardは全経路の仕事量制限ではない。過去selection/rule数、failed候補、未解決取消、他process競合を制限せず、Controlのpublic APIや旧DBを迂回できる。現行にはG/C/R全体のshipping上限がない。

後続leafで、選択対象総数、rule数、同時live command/candidate、targetあたり予約1件、grantあたり未解決generation、cleanup待ち数を注入可能なadmission budgetとして定義する。予算超過は**新規解除/候補準備**を拒否し、未解決作業を切り捨てない。既存DBが予算超過ならread-onlyの全件集計を伴うhost診断/復旧へ進み、callbackがLIMITしたsubsetを全状態として適用しない。具体的な数値・callback時間予算は実機測定と人間レビューで決める。

現在の同期bridge→actor job→`reconcileSynchronously`終了待合せを維持する。semaphoreにtimeoutだけを付けてreturnし、Taskが後からOSを変更する方式は禁止。協調停止を導入するならOS操作開始前の中止とdurable stateを定義し、実行中同期OS操作を取り消したと偽らない。短い同期own-store操作が実機予算に収まらないなら方式を再検討する。

有界telemetryの提案値は固定64 slot、slot最大128 byteの専用共有診断ringとする（値もレビュー対象）。固定コード`open_schema/open_busy/open_io/live_corrupt/apply_uncertain/result_commit/telemetry_unavailable`、stage、coarse timestamp、build/schema、飽和counterだけを記録する。本文・native token・SQL/bindings・error description・raw command/registration IDを入れない。固定一回のnonblocking書込に失敗したら終了し、再帰retryや可変長ファイル追記をしない。control DBがbusy/corruptでも記録を試せる別ファイルとし、App Group/File Protection、複数process atomicity、実容量、ring自体の破損を別leafで検証する。記録失敗もあり得るので「失敗は必ず記録される」と保証しない。

host起動時はこのringとdurable Applying/Uncertain/gapを読んで「制限回復を確認できない」状態と明示的復旧導線を示す。古いtelemetryを現在のOS成功/失敗と混同しない。自動復旧をUI表示/private取込完了まで待たせず、復旧操作の実行境界は#154と揃える。

## benchmarkと受入

[standalone experiment](../../experiments/issue-155-control-retention/README.md)と[生データ](../../experiments/issue-155-control-retention/results/current.ndjson)が正本。1 rule/2 targets/1 live grant/1 live receiptを固定し、終端1千・1万・10万件を追加する。10万件は合成stressであり、50件/日×約5.5年相当という件数換算だけを意味する。

実Storage/Controlのsnapshot slice・stop・同期reconcile/復旧をrelease buildで実行する。callback相当はfresh open＋makeService相当snapshot＋同期Controlを含み、Apple token decode/monitor journal/file protection/actor bridge/OS操作をfakeで置き換える。warm connection、fresh process/connection、全DBquick_checkを分離する。OS file cacheをflushしていないfresh-openを物理的cold I/Oと呼ばない。

SQL shimはstatement、record-bearing row、BLOB materialization byte、SQLite VM step、writer総保持/最大保持を計測する。Swift JSONDecoder呼出し自体はinterposeしていないため、返されたpayload行を「実測復号件数」と断言しない。HWM/RSS増分はallocatorと既存high-waterに依存する一時メモリの観測下限で、allocation総量ではない。索引query prototypeは正本完全性/新Controlの証明ではなく、残るID点検索とファイル/索引増大を示す下限である。

記録したLinux観測では、終端1万件でもpriming後のsnapshotは10,001 grant payload行を取得し、stopは250,035行、cold callbackは150,021行＋10,005 registration行を取得した。時間中央値は順に0.693秒・19.934秒・11.724秒。10万件の単一stress観測はstop 210.726秒/最大writer 91.753秒、cold callback 124.626秒となった。索引prototypeは1 grant payload＋1 headerのままだが、3列だけのledgerでも12.89MiBへ増える。現行走査の証拠と残存費用の下限であり、提案実装や実機予算の合格ではない。[全結果・メモリ・環境](../../experiments/issue-155-control-retention/results/summary.md)を参照。

設計の必要条件は、terminal JSON不正が現在制御を妨げず、live owner/receipt不整合は同時に拒否し、旧ID/callback/terminal grantが復活しないこと。現行失敗の追試とproposed将来の受入を区別する。新schema実装後に同じfixture規模/同じfull入口で追試し、payload行数がTとともに増えないことを確認する。移行・競合・物理端末のゲートは別途必要。

## 依存する実装leafとゲート

以下は新規leafの具体的scope案であり、この設計PRの完了に実装を混ぜない。人間の設計レビュー/マージ後にIssue化し、依存main反映までBlockedとする。

| leaf案 | scope | 完了ゲート |
| --- | --- | --- |
| A: canonical live schema/API | headers/live詳細/ledger制約、complete-live query、terminal duplicate結果型。製品archive削除なし | 双方向欠落/二重予約/隠れた未完了/owner/result/receipt/採用candidate破損を拒否。terminal JSON破損は継続。旧ID全種のreplay試験 |
| B: host明示移行/互換性 | Aと互換Control consumer/軽量openがmain反映した後。schema6全件検証・atomic backfill・schema切替・旧reader失敗 | 全中断点/容量不足/2process競合、commit前後の再open、旧Extension安全失敗、期限/sequence保持。互換consumer前にversionを切替しない。実機公開ゲートはE2 |
| C: Control/callback経路置換 | A後。全scan除去、G/C/R閉包、同期完了、cleanup queue、lightweight open。#154境界と整合 | 実repository/Control benchmarkでT増加に対するpayload仕事が一定。busy/shared writer、live上限、old callback、OS前後失敗を試験 |
| D: terminal archive/保持 | A後。全文保存/圧縮・本人削除・capacity/転送cutoff。別DB化は個別判断 | archive失敗でもstop/reblock継続、本人削除後の非復活、ledger残存費用・WAL/移行一時容量計測 |
| E1: native観測 | B/C後。bounded ring/起動時復旧表示。#154のjob/trigger境界と接続 | 有界容量/固定試行/無本文・token、障害注入とmatching native build。実機予算合格はE2 |
| E2: 実機callback予算 | B/C/E1後。#49/#50/#52/#131との共通campaign証跡 | 同一SHA/build/端末/OSでcold open・writer競合・長期DB・kill・File Protection・全callback時間/メモリ/OS結果。PC結果をwatchdog合格にしない |
| F: 重い整合診断 | C/#154設計後。全DB検査とarchive意味検査の明示job・障害分類 | 全DBの時間/I/O/競合を別測定。100件batchの上限を流用せず、表示/必須復旧を待たせない。失敗時の原本維持と本人復旧を試験 |

索引/ledgerだけで長期DBが端末予算を超えるなら、別DB/epoch切替を新たな設計leafへ戻す。時間予算・admission数値・terminal duplicate API・telemetry値は未採用のまま残す。
