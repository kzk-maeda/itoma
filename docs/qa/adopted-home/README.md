# 採用済みホームデザインへの移行

対象: #111。U01/U05/U07/U08、DESIGN原則1/3/4/5に沿って、初期の緑色サンプルホームを置き換える。

## 通常起動と表示部品の違い

通常ホームは製品のルールsnapshotをまだ取得しない。時間帯・制限状態・本人の目的・アプリ名を作らず、曜日設定と理由による一時解除が準備中であることを先に伝える。「ルールをつくる」は無効で、保存したように見せる旧サンプル選択は撤去した。ルール作成/解除/native接続の完成は#51/#52/#54/#56へ残す。

状態別のHomeViewには、区間の残り時間・終了時刻・任意の本人の目的・対象・共通解除入口を表示する部品を実装した。実際のHomeScreenはperiodを渡さないため、通常起動に円は出ない。ルールなしで円を出さないUI01、目的なしで引用面を出さないUI36に従う。次の接続ではViewModelから確定区間と表示時刻、許可された操作を渡す。表示timerは未導入であり、この部品がOSの期限処理を行うことはない。

21:00–23:00を21:30に表示するfixtureでは、90分・23:00終了・75%の円弧を表示する。1分未満/丸め/日跨ぎ/不正区間/未来/期限到達を単体検証する。0到達で制限復旧を断定せず、状態確認の文言へ変える。不明な観測は「設定上の時間」と明示する。

## 画面の判断

- 全体の配色はGraphiteColorsへ統一。目的の引用面だけに採用済みの温かい面を使う。
- 情報順は問題→ルールと時間→目的→対象→操作。ホームに履歴や実績の数値を足さない。
- OPEN CIRCLEは固定の画面内ベクター。残り時間の円弧とは別の部品で、回転や読込表示に使わない。アプリアイコン/スプラッシュの完成アセット化は未実施。
- 最大幅480、左右24、本文16/26、操作50pt以上。fontScaleが1.2を超える場合は円の数値を外へ出し、文字を縮めない。補足をopacityで薄くしない。
- SVGは装飾として読み上げから除外し、時間・終了時刻はTextにする。常時アニメーションや表示timerは足さない。
- Webでは既存のhydration対応テーマhookを共有し、初期HTMLとclientの不一致を防いでOS外観へ追随する。

PoC有効iOSビルドは先頭に復帰入口を残す。PR #110 head `6249c5b7e1ceaf25cb6bf53559512217bdf503b0` のPoCRecoveryEntryを再利用し、テーマhookのimportのみhydration対応へ変更した。入口は認可/DBを待たずreplaceで検証画面へ戻る。#110自体のマージ・署名変更・実機証跡の転用は行わない。

## Web画像と確認範囲

通常のExpo WebをChromium/Playwrightで375×667、320×568のLight/Dark表示にした。警告/例外なし、横overflowなし、固定サンプルアプリ/架空の円なし、無効な作成操作、Darkの実背景色を確認した。外観確定を待って撮影し、初期のLight HTMLをDarkの合格画像へ転用していない。

| 画像 | 条件 |
| --- | --- |
| [home-light.png](home-light.png) / [home-dark.png](home-dark.png) | 通常ホーム・375幅。実機PoC opt-inなし |
| [home-light-320.png](home-light-320.png) | 通常ホーム・320幅 |
| [fixture-purpose-light.png](fixture-purpose-light.png) / [fixture-purpose-dark.png](fixture-purpose-dark.png) | 状態別HomeViewの表示用fixture。架空の区間/対象/文章であることを画像内に表示 |
| [fixture-unknown-light.png](fixture-unknown-light.png) | 観測が不明でも制限成功を断定しない |
| [fixture-large-dark.png](fixture-large-dark.png) | 320幅、fontScale分岐とCSS文字200%の折返し確認。iOS Dynamic Typeの合格ではない |

fixtureは製品に追加したルートや実設定ではない。同じHomeViewを一時的なReact Native Web harnessへ読み込み、SVGのWeb実装で描画した。harnessでは未使用のSVG native audio moduleを空実装にし、画像AssetRegistryをWebへ解決した。これをiOS linkingやOS動作の検証としない。スクリーンショット取得時のUIソース/lockfileのhashは[source-sha256.json](source-sha256.json)、検証commit SHAとnative run/build IDは対応PRへ記録する。

## 受入条件と限界

UI01/22/23/24/25/33/34/35/36のうち、未接続の正直な表示・DOM/role・配色・静止状態・狭い幅を限定確認。UI02/04/15/20/28の表示部分はfixture/単体検証であり、実OSの成功ではない。基本文字と目的面のペアは4.5:1以上、操作のaccentは3:1以上を計算する。lineは装飾だけに使う。

Native QAはこの変更を含むunsigned Releaseビルドで、bridge→PoC画面のreadonly取得→ホームmountを確認する。外観ごとに新しいプロセスと別ログで同じ証明を取り、ホームの画像を保存する。生成画像はPRで目視してから結果を記録する。稼働中の外観変更、最大Dynamic Type、VoiceOver、実機の導線/制限停止、曜日予定/理由解除/再制限、アプリアイコン・スプラッシュはこの画面移行では合格にしない。
