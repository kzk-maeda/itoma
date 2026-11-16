# 閲覧Stackと作業フロー

#217の本人の実装依頼に基づくPRレビュー対象。実機のgesture/読み上げ/メモリ確認は[QA](../qa/browsing-stacks/README.md)に分ける。

## 所有と階層

RootのScreenTime/Onboarding/History/Reflection Providerは各1つのまま。`(main)`のカテゴリgroup `(home)/(reflection)/(settings)` がそれぞれ閲覧Stackを持つ。選択中タブはNavigatorのカテゴリ名から決める。public URLはroute groupに依存しないため従来の `/settings-schedule` 等を維持する。

`(work)` はRootの全画面作業フローと内部Stack。本人の追加要望により、先頭画面でも標準の左端popが使えるcard presentationを選ぶ（以前のfullScreenModalから変更）。背後のタブの操作/読み上げ除外と `accessibilityViewIsModal` は維持する。Root/各子Stackは `gestureEnabled: true`、`gestureDirection: horizontal`、`fullScreenGestureEnabled: false` を共有し、iOS 26以降の全幅gestureを明示的に無効にする。独自gestureや別の戻り履歴は追加しない。

`AppNavigationProvider` がRAMの型付き `BrowseDestination` returnContextだけを所有する。任意URL/本文/tokenを戻り先へ渡さず、domainの処理・解除期限・保存形式を所有しない。

| 操作 | 帰還先 |
| --- | --- |
| タブ選択 | 対象カテゴリの既存Stack、同じ選択は無操作 |
| 明示リンク/直接リンク | `browsePath`で定義した目的地の論理的な親階層 |
| 既存ルール保存 / 名前・目標保存 | 対象UUIDの保存済み詳細 |
| 新規ルール保存 / 削除 | 識別した新規詳細（不明なら一覧） / 一覧 |
| 受理済み解除 | ホーム→解除状況 |
| 工程内の戻る | 同じmodalの前工程、初工程なら型付き起点 |
| 閉じる | returnContext、cold start時はルールなら一覧、その他はホーム |

`WorkFlowBoundary` にchildのdirty guardを登録し、フロー全体のremoveに `usePreventRemove` を適用する。「‹」からの戻りもnativeのpop要求も同じguardへ通す。内部の戻りはremoveされるchildからRootへ昇格させたguardにより入力を保持する。child effectsの切替中もRoot draftを保護するfallbackを持つ。取消ack前には退出を許さず、busy/取消失敗は保持する。初回設定は既存のdurable flush/退出条件を維持する。

受理済みnative処理は画面が消えても継続する。UIのsession世代とmounted lifetimeを照合し、古い応答で新しいdraftを消したり、新しい画面を古い完了先へ移動したりしない。private保存は既存のCAS/追加UUID照合を使う。

## SDK58との境界

Expo58/Router58.0.30の公式versioned Stack/Modal/Custom Tabs資料と配布型定義を確認した。`unstable_settings.anchor` で初期親を設定する。SDK58のRESETは部分的なNavigator treeを補完しないため、Rootを手作りしてresetしない。

`activeBrowse` はSDKの透明な `__root` を含む既存stateを辿る。`canonicalStack` は対象の**完成済みの子Stack**だけを正規化し、既存route keyを再利用する。新しい親のkey採番はSDKに任せる。既に正規形ならdispatchしない。非選択カテゴリは変更しない。

Rootの `UNSTABLE_router` adapterは既存 `(main)` へのNAVIGATE/PUSHをpop付きNAVIGATEへ変換する。これによりworkを単にblurして残すことを防ぎ、remove guardへ通す。それ以外のactionは元のRouterへ委譲する。実SDK StackRouterの100回反復テストとWebの外部navigateで検証する。SDK更新時はこのadapterを再確認する。

## データ保持と失効

History Providerの一覧query/ページ/位置と、private本文の寿命は従来どおり。容量画面は独立したbounded page読み取りで容量情報だけを使い、一覧を初期化しない。返された一覧rows/cursorは容量側へ保持しない。revision/timeZone/削除epochが変われば旧一覧/本文を失効する。新しいwriterやbackground timerは追加しない。

履歴の総メタデータ量の上限/長期利用メモリは#214の範囲。今回のStack上限確認をiOSプロセスのRAM合格や全履歴の常時一定量保証とは扱わない。
