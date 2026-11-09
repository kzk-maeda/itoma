# 保存済み検証対象の表示と再制限（限定PoC）

状態: **レビュー前・実機確認待ちの限定PoC提案（作業ブランチで実装）**。本人の改善依頼に基づく[#119](https://github.com/kzk-maeda/itoma/issues/119)。製品の再開/認可モデルやPoC全体の採否を確定しない。

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

native viewのサイズはSwiftUIで測定して数値だけ返し、Dynamic Typeで内容を固定高さに切り詰めない。実際のVoiceOver・文字拡大・Light/Dark・古いtokenの表示/初期選択の挙動・SRE05での再制限/取消は変更を含む新ビルドで別途確認する。旧buildの結果はstale native buildであり、この提案の実機合格に使わない。
