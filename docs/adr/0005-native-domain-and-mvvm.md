# 0005: UIは小さいMVVM、制限評価は共通Swift層を正本とする

- 状態: **Proposed**（人間の比較レビュー・採用待ち）
- 検討Issue: https://github.com/kzk-maeda/itoma/issues/24
- 決定PR: https://github.com/kzk-maeda/itoma/pull/36 （比較レビュー中・採用未決定）
- 採用日: 未定
- 検証状況: 設計上の検討のみ。純粋ロジックのテスト仕様を作成、実装・実機は未検証
- 関連ADR: [0002 MVP](0002-mvp-scheduled-restrictions.md)。0003〜0006は同じ設計PRの相互依存する提案

## 背景

Swiftを学びやすく、仕組みをシンプルに保ち、画面を離れても反映を処理したい。失敗は本人が再試行し、画面stackと購読の肥大化を避けたい。MVC等を比較してADRへ残すという希望がある。

## 選択肢と比較

| 案 | 評価 |
| --- | --- |
| MVC相当・fat screen | 少ない部品で始められるがUIの寿命と処理が結合 |
| **MVVM＋薄いI/O Service/Repository** | 画面draftとnative処理を分離し、小さい単位で学習・テスト可能 |
| Redux等の全状態store | UIイベント追跡は便利だがSwiftとの二重正本・依存が増える |
| 完全Clean Architecture | 厳密な境界の代わりに初版の型・変換・層が増える |

## 提案

React Native画面はhook/reducer等のViewModelでdraft・表示状態を扱う。型付きNative Clientを通し、本体SwiftのCommandServiceが処理を所有する。純粋Swift Evaluatorを本体とExtensionで共有。TSにOS制限の優先評価を複製しない。I/O境界はRepository/Adapterへ寄せるが全操作に定型層を作らない。

詳細仕様の正本は [architecture.md](../system/architecture.md)。採用前にコードの確定仕様と扱わない。

## 影響・限界

同じ画面を反映後にpushし直さず戻り、購読/タイマーを破棄する。Swift actorは本体内のみの調停で、プロセス間排他は共有SQLiteの短いwriter transactionを使う案。OS副作用とDBはatomicでないためdurable intentで不明状態を検出。Adapterの実API/同期区間/時間予算はPoCで要確認。

## 証拠と採用条件

Issueの利用者回答を根拠にした設計判断。OS APIの現行仕様と端末条件は [PoC計画](../system/poc-plan.md) で確認する。提案の採用と実機での成立を分け、失敗したら範囲/方式を見直す。比較対象のAPIを実装済み・動作済みと記載しない。

## 再検討条件

Extensionで共通層が使えない、writer区間中のOS操作が長い/非同期必須、MVVMの部品がfat controllerへ成長する、実測で画面/メモリが増え続ける場合。
