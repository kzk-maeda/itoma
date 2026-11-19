# 通常ルールの背景開始・終了（#222）

状態: **この修正を含むbuildでの実機結果は未取得**。PR228の専用PoC開始/終了1caseは本手順の合格ではない。
設計提案は[ADR0011](../adr/0011-host-confirmed-rule-execution.md)。主に#131/#135へ結果を記録する。

## Buildと準備

- このPRの完全なsource SHA、host/Extensionを含むbuild ID、JS SHA、native config一致、端末/OS/Xcode、JSTの実測日時を記録する。古いnative buildでJSだけを更新しても本修正は入らない。
- 専用PoCは停止し、通常ルールのstore/monitorを使う。通常の認可・対象選択・本人の有効化を完了し、一度hostで現在状態を確認する（upgradeではこの時点で現在policyの実行資格を発行する）。資格の手動編集やPoCのapproved代用をしない。
- 3分後開始・20分後終了など、境界を確認できる通常ルールを保存する。最低15分のmonitor intervalは既存通り。対象は最初1アプリ、次に複数アプリで実施する。
- Consoleでhost/Extension image UUID一致を確認し、`itoma.screen-time` / `normal-rules`の固定語彙ログを採取する。raw DB、token、理由、署名情報をGitHubへ貼らない。

## 必須ケース

| ケース | 操作・確認 |
| --- | --- |
| 背景開始 | hostをバックグラウンドへ置き、ロック。開始の約28分後など15分windowを越える確認も別ルールで行う。ITOMAを開く前に対象アプリのShieldを確認する。callback時刻、raw unknown/notRead/approved、再評価結果を記録 |
| 背景終了 | hostを開かず、予定終了後に対象が使えるか確認。対象を前面に置いたままのケースも分ける |
| 既存解除 | 予定内で一部アプリだけ5分解除。hostを背景へ移し、他対象の制限維持・解除期限後の再制限・期限の非延長を確認 |
| 停止・競合 | active中と開始直前に全停止。旧callbackが来ても再開始しない。停止→明示resume後は最新policyだけが対象になる |
| 変更・旧callback | 時刻/曜日/対象変更、ルール無効化を保存。未保存候補や旧revisionの対象が復活せず、最新policyに従う |
| 認可取消 | Screen Timeから実際に取り消す。hostがdeniedを観測した後、再許可だけでは再開せず、対象再確認・明示resumeを要求する。hostが取消を観測しないケースは別に記録し、成功と推定しない |
| receipt失効 | 解除期限のcallback/再起動・中断ケースで、期限切れや失効receiptが解除を復活/延長しないことを確認 |
| 再起動等 | 強制終了、端末再起動、初回unlock前後、ロック、時刻/zone変更、DB利用不能を別ケースとして記録。通常背景の1caseと混ぜない |

## 結果の読み方

`authorization=unknown`はmainから取得したnotDetermined等、`notRead`は250ms以内に取得できなかった状態。どちらもapprovedではない。`result=committed failure=none`だけで対象アプリのShieldや継続時間を合格にしない。runtime unavailableなら権限のほかApp Group/DB/File Protectionと新build一致を切り分ける。

このPRはunknownでの**制御**を修正する。振り返りではunknown認可の操作成功だけを成功時間に昇格させず、過去の欠測も補完しない。実機の制限開始/終了・解除除外と時間集計の受入は、それぞれ時刻と観測条件を添えて別に報告する。
