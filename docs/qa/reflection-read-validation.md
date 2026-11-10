# 振り返りreadの検証再利用

対象 #140 / Refs #98。PR139からschema/指標/bridge/UIを変えず、同じ接続・同じDB snapshotの全payload検証成功だけを再利用する。[内部契約](../system/reflection-records.md)と採用済みの削除/同token契約を維持する。

## 回帰で確認する境界

- 一度正常に読んだ後、外部SQLite connectionからrevisionを変えずにpayloadを壊しても、次read/openを破損として拒否する。
- 自分のconnectionのwriterはdata_versionが不変でも失効する。writer内の途中の正常検証を、その後の変更へ再利用しない。検証失敗はrollbackし、再読取で空/0や削除前データを生成しない。
- WALのread snapshot中に外部writerがcommitすると、そのreadでは旧data/旧data_versionが対応し、次readで新しいcommitを検証する。
- 外部のcutoff/schema破損を隠さない。既存の削除・取込・token/revision/zone/as-of・再open/移行・点観測nil testsも継続する。

## 性能診断の範囲

PR139時点の #98 comment6759041092 にbaselineの実行コード/原本がある。同じ最小の合成SQLiteデータ1/10/100MiB、Release、各fresh processでopenと同connectionの3readを分ける。sourceをread-only mountしてbuildし、count一致とtotal.knownSecondsのnilを確認する。比較するsource/tree、harness hash、compiler/SQLite、各値とchild peakRSSを対応PR/Issueへ記録する。

OS cacheを落とした測定ではない。Swift child全体のRSSで、RN/iOS memoryの上限や100回の実route往復を示さない。SQLite main fileだけをpayload/DB+WAL/SHM総量と呼ばない。全durationのnilは既存testsの保証で、このbenchのassertはtotalのみ。初回検証・変更直後のread・通常capture/import/DDL index・実機の待ち時間は別の未完了項目として残す。

data_versionはSQLiteを通じたcommitの変更検知であり、ファイルの直接書換/置換や媒体破損を常時監視する機能ではない。cacheを別connectionへ持ち越さず、open時の全検証と毎readのschema/SQLエラー処理を継続する。

開発中、Swift compile/testと並行したJestの通常動線1件が既存の5秒timeoutとなった。失敗を成功へ転用せず、Swift完了後に同じtest/source・既定timeoutのまま全Jestを再実行して最終結果を記録する。型/lint/doctorはこの失敗と別に判定する。

署名無しNative QAは変更したItomaHistoryの実compile・既存Reflection read-only route→Homeを同headで確認する。ready DTOのnative操作、実Shield/実機、File Protection/App Groups、実際の制限時間の正値qualificationは #131/#135/#98 に残す。
