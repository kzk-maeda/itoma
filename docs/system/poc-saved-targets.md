# 保存済み検証対象の表示と再制限（限定PoC）

状態: **限定PoCの実装・記録はPR #120/#121でmain反映済み（SRE05の通常操作を本人確認、製品仕様の採否と全PoC合格は別）**。本人の改善依頼に基づく[#119](https://github.com/kzk-maeda/itoma/issues/119)。製品の再開/認可モデルやPoC全体の採否を確定しない。

## 問題と本人のタスク

保存した対象が件数だけでは識別できず、アプリを開き直すたびに対象をゼロから選び直す必要がある。検証対象を把握し、本人が確認して再び手動制限できるようにする。

## 境界

- Apple公式の[Activity Label](https://developer.apple.com/documentation/familycontrols/displayingactivitylabels)をSwiftUIで描画する。アプリ名/アイコン/tokenをJS・ログ・URLや解析へ渡さない。JSのnative view propsはランダムSelectionRef、layout eventは高さだけ。native viewは表示のための読取のみで、認可・DB作成・制限要求をしない。
- 各保存行は対象表示と操作を関連付ける。今回のPickerで確認済みなら既存の明示確認ダイアログから要求する。それ以外は「保存した対象を確認して制限」からnative Pickerを開く。認可が現在approvedで保存内容を読める場合に利用できる。画面を開く/描画する/再許可するだけでは適用しない。
- native Pickerには保存した対象を初期選択として渡す。本人がOSの選択内容を確認して「制限を開始」を押すと、選択検証・保存・現在の認可とepoch確認の後にのみ専用ManagedSettings storeへ適用要求する。同じ集合なら元のSelectionRefを再利用し、再確認だけで同じ履歴を増やさない。変更した集合は新SelectionRefとして保存する。
- 取消では保存/制限を変更しない。Picker表示中にSQLite transactionを保持しない。認可取消や未認可状態からの認可要求を観測した場合は保存tokenを初期選択に流用せず、空のPickerで新しい選択を求める。背景移行で確認資格を失効し、停止操作も進行中Pickerのepochを失効して後からの再適用を防ぐ。
- [Appleは認可取消で旧tokenが無効になると説明](https://developer.apple.com/documentation/familycontrols/familyactivityselection)している。**プロセス停止中の取消→再許可を完全に検知したり、Pickerの初期選択が必ず有効tokenへ更新されるとは保証しない。** OSのラベル/Picker表示と実アプリのShieldを実機で観測する。名前が表示されない/対象が違う場合は新規選択へ戻る。OS readbackを実効制限の成功と表示しない。
- 既存の選択DB schema/payloadは保持する。デコード/DB障害を初期化で隠さない。停止はDB/認可/選択と独立して自分の専用storeだけを消去できる。
- `screenTimePoCUIVersion >= 2`を新しいnative機能の条件とする。旧buildでは表示/再確認入口を使えると装わず、新ビルドが必要と表示する。既存の停止は残す。

## 根拠と未検証

SDK58のExpoView/Prop/EventDispatcherとrequireNativeViewManager、およびAppleのLabel(ApplicationToken)、FamilyActivityPicker、FamilyActivitySelectionを参照。UI21/22/23/24/25/26、DESIGN原則1/3/4/5の限定範囲に対応する。本文・余白は共通トークン、Apple提供のアプリラベルはnativeのシステム表示を使う。名前の取得APIやダミー名で本物の対象を置き換えない。

native viewのサイズはSwiftUIで測定して数値だけ返し、Dynamic Typeで内容を固定高さに切り詰めない。SRE05での通常操作と文字拡大・VoiceOver・Darkの本人確認は下記の範囲に限定する。最大文字・長い名前・無効tokenの全経路等は未検証。旧buildの結果はstale native buildであり、この提案の実機合格に使わない。

## 変更を含む実機での部分確認

SRE05/iPadOS27.2で、保存名・アイコンの表示、対象確認後の再制限、停止を本人が確認した。[対象SHA・build ID・範囲と未検証](../qa/poc-saved-targets/README.md)を参照。取消/認可変更/無効token/全反復の保証や、提案の採用と同義にはしない。

PR #121後の追加報告では、確認Picker取消、端末再起動/オフライン、認可取消/再許可、文字拡大・VoiceOver・Darkは案内範囲でOK。ITOMA終了中の取消後にアプリへ復帰して再許可すると新規選択が必要で、対象を確認できない保存行が蓄積する。[#123](https://github.com/kzk-maeda/itoma/issues/123)で表示・再選択・整理方針を検討する。DB/tokenの削除を直接確認した結果ではなく、製品仕様の変更は未採用。詳細は上記QA記録を参照。
