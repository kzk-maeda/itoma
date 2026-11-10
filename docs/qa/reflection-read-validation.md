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

## 2026-11-10 JST の結果

source `6c9ce806567b8a7ed728530d2394858a8d19398b`、local `a07bdfd76dad0999956d9dbe8d13a1c314978020`、tree `3b52e58de1d76985c7591dd32c38398add73d768`。Core74/Storage126/Control85=285、Jest最終112/14 suites、型/lint/demo20/iOS tools18/doctor20/20成功。初回Jestの5秒timeout1件は失敗として区別し、source/既定timeoutを変えない再実行112件（5.669秒）を採用した。独立sourceレビュー2名でblockingなし。同head CI/Native原本の最終結果は対応PRへ記録する。

[計測JSON](reflection-read-validation/benchmark.json) / [baseline](reflection-read-validation/benchmark-baseline.json) / [hashと実行source](reflection-read-validation/provenance.json)。同じDBをコピーし、実hash・count・payload bytesを照合。Swift6.2.3/SQLite3.37.2 Releaseで、同じmain.swiftによるopen後の3回の週readを比較した。月への切替の正しさは別の既存Swift/Jest回帰で確認する。

| payload / fact数 | 以前のread中央値 | 新read 3回（秒） | 新open | child peakRSS |
| --- | ---: | --- | ---: | ---: |
| 1,048,557 B / 2,982 | 0.081秒 | 0.00210 / 0.00074 / 0.00074 | 0.088秒 | 31,496 KiB |
| 10,485,702 B / 29,736 | 0.808秒 | 0.00936 / 0.00874 / 0.00667 | 0.905秒 | 31,992 KiB |
| 104,857,329 B / 296,521 | 8.189秒 | 0.08096 / 0.08519 / 0.08917 | 8.158秒 | 32,364 KiB |

100MiBのread中央値は約0.085秒で、この診断では約96倍。初回openの全検証は約8秒のまま残る。時間値はtotalのnilを確認し、observationCountは全件一致した。新しい測定も実機やcold I/Oの合格ではない。

初回の[比較harness](reflection-read-validation/benchmark-first-hash-buffer.py.txt)はhash計算にread_bytesを使い、Swift childを起動する前のPython親がDB全体をbufferへ読んだ。wait4 peakRSSへ親/fork時の影響が混ざり、100MiBで209,104 KiBとなったため、その値を製品memoryとして採用しない。[初回原本](reflection-read-validation/benchmark-first-hash-buffer.log.txt)を保持した上で、[1MiB chunkによるstreaming hash](reflection-read-validation/benchmark-measure.py.txt)へ直し、fresh driver/同じSwift binary・DBで測り直した最終値を上表へ記載した。製品のcacheは整数1個のみであり、この修正は測定harnessだけである。

再現はbaseline #98 comment6759041092の3データを別作業directoryに生成し、ここに保存した[Package.swift](reflection-read-validation/benchmark-package.swift.txt) / [main.swift](reflection-read-validation/benchmark-main.swift.txt)をbuild、baseline directoryを `/baseline`、fresh candidate作業directoryを `/work` へmountして `ITOMA_BENCH_COMMIT=<source> python3 /work/measure.py`。mountはローカルの合成DBだけで、実データに対して実行しない。
