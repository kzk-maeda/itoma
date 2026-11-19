# ADR 0011: Extensionでの通常ルール実行と生の認可観測を分ける

状態: **Proposed（実装を含むレビュー対象、実機未検証）**。2026-11-19 JST。
関連: [#222](https://github.com/kzk-maeda/itoma/issues/222)、[引き継ぎ #227](https://github.com/kzk-maeda/itoma/issues/227)、[限定PoC PR228](https://github.com/kzk-maeda/itoma/pull/228)。ADR0003/0005/0006の変更提案。本人の通常ルール実装依頼に沿って同じPRで提案・実装する。採用には人間のレビューが必要。

## 問題と根拠

通常経路はExtensionの`AuthorizationCenter.authorizationStatus`がunknownだと、開始・終了・解除期限の現在状態再評価をOS書き込み前に止める。PR228ではmain queueでの取得/250ms観測でもnotDeterminedが残った。一方、独立store/単一対象の20分PoCではhostを開かずShieldの開始・終了を本人が確認した。これは通常ルール・解除・時間集計の合格ではない。採用する根拠はPR228/#227の公開済み検証結果のみで、raw DBやログアーカイブを転載しない。

## 比較

| 案 | 評価 |
| --- | --- |
| main queueで生の認可を読み直すだけ | APIのqueue条件は満たせるが、実機の初期notDeterminedでは通常制御が止まる |
| unknownを過去のapprovedに変換 | 生の観測・本人意図・取得不能を混同する。新しい解除まで許可する危険があるため不採用 |
| PoC専用store/Pickerをそのまま通常経路へ移す | current policy、grant、receipt、停止の正本が分裂するため不採用 |
| **host確認済みの現在policyの実行資格を別に持つ** | 採用提案。OS観測はunknownのまま、通常ルールの既存意図だけを実行する。追加の無効化・競合検証が必要 |

## 提案する契約

1. 認可の生値と時刻は`AuthorizationObservation`に保持する。`RuleExecutionAuthorization.hostConfirmedPolicy`は別の資格であり、OSのapprovedではない。Coreはデフォルトでは従来のlive認可を要求する。
2. hostがapprovedを観測し、現在のActivationがenabledであるwriter内で、確定policy全体・最新activationCommandID・確認時刻を共有SQLiteの任意journalへ保存する。候補の準備、監視登録receipt、Extensionのapprovedからはこの資格を発行しない。確定直後のpolicyと明示resumeにも同じ条件を適用する。upgrade後はhostの通常再評価で発行し、インストール時に過去の認可を補完しない。
3. 利用は`ControlOrigin.activityExtension`かつraw unknownかつenabledに限定し、writer内でpolicy全体/最新有効化ID/確認時刻（未来でない）を照合する。host unknown、paused、awaiting、denied、資格なし/不一致/壊れた保存では利用しない。approvedの通常経路は維持する。
4. policy/Activation/activationCommandID、既存selectionの更新・削除でSQLite triggerが資格を無効化する。schema6の旧writerによる停止→再開の往復も無効化する。未保存候補は現policyを置き換えず、古いcallbackも最新policyを再評価するだけ。Preparing/Applyingと最終OS書き込みの間にも現在状態を検証する。
5. 観測したdeniedは資格を失効させ、enabledからawaitingへ移し、grantを失効させる。host publisherのdeniedもJS呼び出しを待たずnative actorへ通知する。approvedへ戻っただけでは再開せず、本人のresumeと対象再確認を要求する。rollback後の観測再生はnegative factsだけで、古いapprovedから現在policyの資格を発行しない。
6. **新規grant・retry・解除を伴う候補・resumeの認可条件は変更しない。** 既存grantの継続は成功command/Registered receipt/未発火/世代/現在rule・occurrence/固定期限/短縮上限を引き続き照合する。P1/P2を省略せず、callbackは登録再試行や期限延長をしない。失効receiptから再制限する。
7. 停止は耐久pausedを先に保存し、自storeだけをclearする。任意journalの発行/メタデータ保存失敗はhostの停止を妨げない。Extensionで資格を検証できなければ、stale/空planでの代替writeは行わない。ExtensionはDB/journalを作成・移行・修復しない。
8. `AuthorizationCenter`はmain queueで読む。hostはmainの現在プロセス内のread/publisher値をlock保護の観測へ渡す。Extensionはactor joinより**前**にmainで一度読む。main callbackはinline、worker callbackはmainへenqueueして最大250ms。timeoutはnotReadでありnotDeterminedやdeniedと同一視しない。late workは完了済み評価へ戻さない。writerからmain.syncしない。

## 時間集計と診断の境界

- `ApplicationObservation.applied/ownStoreReadback`は、現在の自storeへの操作・readbackの結果。新しい実行資格はシステム全体の実効遮断や継続時間の証明ではない。
- journalには最後のevaluationIDと生の認可も1件だけ保存する。Reflectionの正値qualificationは、対応するapproved観測、または現在の認可・own-store等を確認する明示native checkpointを要求する。**delegated unknownでの操作成功だけでは時間を加算しない。** unknown/失敗gapや過去の欠測を設定時間から埋めない。記録方式の変更はこのPRの対象外。
- 固定語彙の`itoma.screen-time / normal-rules`ログで、callbackのrule/deadline、raw approved/denied/unknown/notRead、再評価結果を分ける。rule名/ID・対象token・理由・raw errorを出さない。PoC専用store/UI/ログexporterは取り込まない。
- journalは単一行で上書きする。callbackごとの資格履歴を無制限に蓄積しない。schema6は維持し、hostが明示的に任意schema version1を導入する。

## 限界と受入

生のunknownから、実際の未許可・未観測の取消・Extensionの初期化不足を完全には判別できない。この提案は最後にhostで確認した**本人の意図**を実行するもので、過去の承認でOSの権限を付与する仕組みではない。OS権限が実際に取り消されれば、OSが最終的な適用可否を決める。観測できなかった取消/再許可の往復をすべて検知したとは主張しない。`ManagedSettingsStore.isActive`はstoreを実効設定計算へ含めるフラグであり、Family Controlsの認可の証拠に置換しない。

DeviceActivity callbackの欠落/遅延、File ProtectionによるDB利用不能、process kill/reboot/初回unlock、clock/zone変更も別の実機検証対象。この変更はそれらを保証しない。[通常ルールのQA手順](../qa/normal-rule-background-authorization.md)に沿い、このSwiftを含む新buildで開始/終了/解除期限/停止/取消を確認する。#131/#135/#98/#222はPR228の1caseだけで完了にしない。

Apple資料（2026-11-19参照）:
- https://developer.apple.com/documentation/familycontrols/authorizationcenter/authorizationstatus — 初期notDetermined、main queueの条件。
- https://developer.apple.com/documentation/managedsettings/managedsettingsstore/isactive — inactiveは実効設定計算から除外、default true。
