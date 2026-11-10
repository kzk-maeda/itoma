# 振り返り製品接続の検証

対象 #138、設計は [製品接続](../system/reflection-records.md) / [採用契約](../system/time-reflection-contract.md)。設計採用は本人によるPR134マージで確認。source・Web・署名無しSimulator・署名済み実機を区別する。

## 確認する体験

通常ホーム→自分の時間→月/週→月内のclip週→日→操作履歴→理由→戻る。上部は期間移動で対象を変えず、全期間/累積切替は置かない。prototypeの正値は製品parserから拒否する。

本版はpoint-onlyの製品接続。画面に集計準備中を示し、時間は既知0にもせず「—」。記録数・取込/欠落・削除状態を表示できるが、実際に制限を続けた時間の計測が完成したという主張はしない。正値のqualificationは #98/#131。

## ローカルの確認層

| 層 | 確認内容 |
| --- | --- |
| Core/Storage/Control | 共通Swift tests。aux後付け/旧writer gap/ack非増殖、same-commit/rollback、combined capacity、old schema3移行、同token、削除前未取込/cutoff、新factの競合生存、ended baseline、破損拒否 |
| TypeScript/Jest | 製品parserのnamespace/point数値拒否、古いnative build、query allowlist、固定累計/週月/clip/History往復、別as-of説明、全削除の明示確認/連打/旧応答/held reason、shared gap、root subscriptions |
| Source smoke harness | Reflection bridgeまたはroute自身のreadが欠けるとHome PASSにできない。通常launchは無効 |
| Web | Light/Dark・狭幅・文字1.5倍・未記録/削除/欠落/読取不能。合成SQLite fixtureの明示付き。DOM文字倍率をiOS Dynamic Typeへ転用しない |

成功件数と実行headはPR本文の最終結果を正本とする。開発中のSwift macro/入れ子savepoint/旧schema fixture・JS戻りラベル/spy cleanupの失敗は修正後と区別し、失敗した実行を成功証拠へ流用しない。

## SQLiteから作るfixture

Core/Storageの実Repositoryを使い、一時Control6/History4へ合成factを作る。actual token・実アプリ名・本人の理由・Screen Time APIは使わない。生成targetはTools配下で、Pod/Extensionのsource globに入らない。

    swift run --package-path packages/itoma-storage --jobs 2 reflection-record-fixtures 2026-11-10

出力をtests/fixtures/reflection-records.jsonとしてclient/UI testsへ入力する。observed/notRecorded/deleted/incompleteの各DTOはrestricted-excluding-unlocks-v1 / pointObservationsで、全時間値はnil。Calendar/clipはSwiftの結果を使い、TSで計算式を写経しない。

実RepositoryのUUIDとcapture時刻を残すため、再生成はbyte同一ではない。metric/scope/count/coverage・境界・同tokenと数値nilの不変条件を照合する。画像に使った原本のhashと生成元sourceは画像manifestへ記録する。

## Native QAの証明範囲

新しいSwift/Expo bridge/History4を含む対象headで unsigned Release buildを実行する。result.jsonのrequested/source/native/JS/workflow SHA、build ID、native config/JS bundle digest、18stages/status/cleanup、MacのSwift件数、compile/buildログ、Extension embed、Light/Dark画像を原本で確認する。

正常routeのproofは bridge→read-only PoC→read-only History→read-only Reflection→Home。Reflection route自身がprivate DB未作成のtyped readを返した後にだけHome PASSを許可する。実行は権限prompt/Picker/予定登録/Shield/理由保存/実履歴削除を行わない。

このsmokeはready DTOのnative描画、月週日操作、取込/全削除の実機操作を実行しない。Web/Jest/Linux SQLの成功をその証拠へ読み替えない。App Groupへの実アクセスも未検証。

## 実機で残すチェック（#131/#135）

1. host/Extensionのsource・JS bundle/native build ID/config、端末/OS・zoneを記録。CI unsigned build IDを署名済みbuildへ付け替えない。
2. 既存History3の理由/操作/削除tombstoneを保持して4へ移行。失敗・lock・容量で空に戻さない。Control6/monitors1の制御を継続する。
3. host初回maintenance前のExtension callback、aux install/index作成との競合、JS停止中のsource capture、再起動・初回unlock・File Protection/backup・別process writerを確認する。最大履歴でindex作成とstop/reblockの時間を別計測。
4. ルール確定・解除/早期終了/失敗/再制限・停止/明示再開・認可取消で新しい点の記録が継続する。未知区間を時間に昇格させない。
5. read/import/容量不足を繰返して重複しない。private commit後ack前の中断、未取込/実欠損、source変更を分ける。
6. 理由/操作だけ削除ではreflectionを保持。全記録は別確認し、取消では不変、承認では古いoutbox/旧応答から復活しない。active/ended・再制限待ちのbaselineは加算再開やOS変更にしない。
7. 月→clip週→日→理由→戻る、ホーム復帰、zone変更、並行更新/全削除で旧tokenを更新し、取得時点の違いを説明する。
8. Light/Dark、最大Dynamic Type、VoiceOver情報順・グラフ代替文、Reduce Motion、戻るgesture、日本語IME、狭幅、100回の実往復/背景復帰/最大容量のmemory・購読・所要時間を確認する。

実機は本人/実機QA担当が操作する。PR124は旧PoCの確認で、新しいhost/Extension/History4/Reflectionの合格に流用しない。未実施・再現不能・失敗を残し、親Issue/goalを一括完了しない。
