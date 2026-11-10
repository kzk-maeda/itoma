# ルール名と行動目標

本人の2026-11-10の実装依頼（#147）に基づく契約。実装PRでレビューする。実機の保存保護・UI合格の宣言ではない。

## 本人の目的を残す

設定の保存済みルールから、任意の名前と行動目標を編集する。制限を設定した理由や、その時間にしたいことを本人の言葉で残す。一時解除の理由とは別のデータで、行動の達成を推定・採点しない。未入力をサンプル文で埋めない。

名前は80、行動目標は1,000 UTF-16単位まで。JSとSwiftで同じ単位を検証し、上限超過/NULは黙って切らず拒否。名前の前後空白は除き、目標は非空白なら改行を含む原文を保持する。両方を空にして保存すれば本人の文章を消せる。

名前が空なら従来の「時間帯 N」を表示。行動目標は登録時のみ、ホームの各時間帯の円の後・対象アプリの前と設定に表示する。文字拡大/長文でもスクロールし、円の数値や状態表示を置き換えない。

## 保存・競合・制限からの独立

- `ItomaHistory`のhost-only `RuleDetailsRepository`を使用する。新しい独立SQLite `Application Support/ITOMA-Private/rule-details.sqlite`、application ID `0x49545244` / schema1 / WAL / FULL。history.sqlite/control.sqliteのschemaを変更しない。
- rule UUIDを主キーとし、名前/目標は現在値1件へ置換する。過去の全文を履歴として追記しない。目標をApp Group、Extension、共有Policy、操作履歴、URL、ログへ書かない。
- nativeの`saveRuleDetails`は、active rule UUID・expected policy revisionとprivate metadata revisionを検査し、writer transactionで本文とprivate revisionをまとめて保存する。制限の再設定やOS予定APIを呼ばず、policy/rule version・snapshot sequence・grant期限を変更しない。
- snapshotにはallowlistした名前/目標、private revision、`ready/unavailable`を載せる。JSはcontrol sequenceとprivate revisionを別々に比較し、遅いreadで新しい本文や制限状態を巻き戻さない。削除済みルールを古いsnapshotから復活させない。
- 本体が最新有効policyを確認してから、削除済みルールの文章をprivate transactionで整理する。整理失敗は`unavailable`とし、次のhost read/saveで再試行する。private障害で制限の停止/再制限を妨げない。
- 操作履歴/理由/累計の削除はこの設定用DBを変更しない。ルール名/目標を削除するには本文を空にして保存するか、該当ルールを削除する。

## 保護と失敗

本体privateのディレクトリとDB/WAL/SHMに既存`ScreenTimeFiles`のComplete保護・バックアップ除外を適用する。接続は各操作の終わりに閉じる。未作成は未登録として扱うが、ロック/破損/未来schemaは空DBで置換しない。読取失敗は本文を表示せず不明を伝える。

保存失敗は入力を保持。競合時は最新の保存内容を読んで表示し、本人が入力値での保存を明示する。未保存のまま戻る/取消では破棄を確認する。古いnative buildで追加capabilityがなければ編集を有効化しない。新nativeを含むbuildで検証する。

SQLiteの再open・競合・破損/未来版・失敗rollback・100更新で1行を単体検証する。iOSのFile Protection、端末lock、実機キーボード/VoiceOver・メモリは#131/#135で確認する。
