# 操作履歴画面の検証

対象 #132 / PR #133、採用範囲は [履歴API・保存契約](../system/history-records.md)。最小フローのsource実装を終えた後、保存済みの操作/理由/削除/容量・欠損を通常画面へ接続する。設定時間の固定累計・週月集計は #96〜#100 の採用前であり、架空の値を表示しない。

## 確認層

| 層 | 実行・範囲 |
| --- | --- |
| Swift / SQLite | Core63、Storage98、Control85。private schema1/2→3、移行失敗rollback、同時刻の前後ページ、revision変更、理由tombstone、旧outbox再取込で索引が復活しないこと、fractional時刻、DST23/25時間・不正日付等。Linuxの一時SQLiteでありiOS File Protectionではない |
| React / typed client | Jest87件のうちhistory client8・flow7・Native Smoke10。明示理由取得、日付/zone/revisionの送信、1ページ置換、削除確認、Settings削除/履歴削除後の旧応答棄却、容量/欠損/読取失敗、History proofなしにPASSしないこと。Pages fixtureは実native Stackではない |
| Native QA | 最終headのrun/build IDと結果はPRへ記録。新historyVersion/read-only pageと、PoC→History画面自身のread-only取得→Home mountをPASS条件に追加。実記録の書込/認可/制限は行わない |
| Web画像 | 下表の合成入力。HTML埋込みではなく本体React Native部品のWeb描画。実DB・OS成功ではない |
| 実機 | 新機能の結果は未記録。下記手順をowner/実機QA担当へ渡す |

Linux検証では公式署名を検証したSwift6.2.3をtask-localに配置し、既存SQLite3.46.1に対応する公式headerを使用した。CIのpinned Ubuntu DockerとMac buildは別の結果としてPRに記録する。初回のschema2固定fixtureをschema3へ修正した。ジョブ作成前のGitHub Internal server error、後続の実テスト失敗、成功runを混同しない。

DESIGN原則1/3/4/5、U07/U08、UI22〜UI26/UI30/UI32/UI35/UI36に対応する。Graphite、状態を言葉で区別する表示、44pt以上の操作、全文を省略しない理由表示を使う。VoiceOver、実機Dynamic Type/keyboard/gesture、往復/接続/メモリ計測の合格は別途必要。

## Web画像の出所

製品コード `04ee94f8127fa83ec96e783095bdaa71ba404c9c` を別コピーへ展開し、temporary route `src/app/history-proof.tsx` だけを加えた。全データ/理由は架空。画像上部に合成データ・実機未検証を表示する。ブラウザはLinux Chromium/UTC、fixtureの取得zoneはAsia/Tokyo、as-ofは2026-11-09T12:30:00Z。後続の証跡/文書commitは表示コードを変えない。

| 証跡 | 条件 |
| --- | --- |
| [events-light](history-records/events-light.png) / [events-dark](history-records/events-dark.png) | 390×844、状態の異なる操作と取消 |
| [day-narrow](history-records/day-narrow.png) | 320×800、日付・zone・前後ページ |
| [reason-large-dark](history-records/reason-large-dark.png) | 320×800、架空長文/改行、DOM文字・行高を1.5倍。iOS Dynamic Typeではない |
| [deleted-light](history-records/deleted-light.png) | 削除済み本文を再表示しない理由一覧 |
| [capacity-gap-dark](history-records/capacity-gap-dark.png) | 容量上限、欠損/未取込、明示再試行 |
| [unreadable-light](history-records/unreadable-light.png) / [not-created-light](history-records/not-created-light.png) | 読取失敗と未作成を区別 |

画像はscroll祖先の高さ/clipを撮影時だけ外した全内容export。固定viewportのnative screenshotではない。実ファイルのdigest、寸法、横はみ出し、console/page error、button高さは [manifest](history-records/manifest.json) に記録する。fixture/capture scriptも同ディレクトリへtxtとして保存し、製品routeには入れない。

再現時は固定sourceの検証用コピーにfixtureだけを配置し、`ITOMA_SCREEN_TIME=0 ITOMA_DEMO_BUILD=1 EXPO_PUBLIC_NATIVE_SMOKE=0 EXPO_PUBLIC_BUILD_SHA=<上記SHA> EXPO_OFFLINE=1 CI=1 npx --no-install expo export --clear --max-workers 2 --platform web --output-dir <一時出力>`。localhostのextensionless HTML fallbackで配信してcaptureを実行する。別コピー間でMetro cacheが混在しないようclearを指定する。初回の旧route cacheのexportは除外し、画像のsource一致を確認する。公開/配布は行わない。

## 実機確認手順

新historyVersionとschema3を含むnative buildが必要。source/JS/native build ID/config digest、端末/OS、現地zone、操作時刻と観測を記録する。既存PR #124のPoC成功を新機能の証拠にはしない。理由は架空のものを使い、実理由/token/実名を証跡へ貼らない。

1. 通常ホーム/設定→「選択の記録」。未作成、保存済み操作、理由一覧、失敗/不明/取消を確認する。操作の完了記録を実際のOS遮断と混同しない。
2. 理由のない取消、理由の保存だけ、解除受理後/失敗の記録を確認。本人が選んでから理由全文を開けること。戻ると日付/一覧位置を保持し、理由やIDがURLへ入らないこと。
3. 40件を超える記録で前後へ移動。同時刻・日跨ぎ・DST・timezone変更を試し、更新後は古いcursorを使い続けないこと。全件を画面へ追加し続けないこと。
4. 理由全削除の確認を取消すと本文保持。承認後は本文なし/削除済み。設定側で削除した後、戻る/背景復帰/遅い応答で本文が復活しないこと。現在grant/ルールは保持する。
5. 操作履歴と理由の削除後、未ackの古い記録の再取込で復活しないこと。削除後の新しい記録は表示できること。欠損と未取込を区別すること。
6. 容量警告/上限、private読取・書込不能、端末lock/解除を確認。DBを空扱い/再作成せず、履歴の処理中も通常の停止・期限後再制限を別に確認する。
7. 既存schema2の理由/操作/tombstoneを保持してschema3へ更新できること。中断時に破壊的初期化をしない。古いbinaryへのdowngradeをDB削除で回避しない。
8. Light/Dark、長文、日本語日付入力/keyboard、最大Dynamic Type、VoiceOverの情報順と状態、戻るgesture、往復100回の購読/接続/メモリを実測する。

これらの未実施を成功にせず、実機QA Issueへ結果を記録する。#131のOS成立・App Groupsゲートも保持する。
