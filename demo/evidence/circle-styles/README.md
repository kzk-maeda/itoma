# 積み上げサークル3案のWeb検証

2026-11-21 JST / #260。UIソース `0e900982949fee74cab17e9a893366be17b1f2eb`、`demo/app` tree `4469ddfb60b671f32c3cf64c846dae113fd6f1a8`。
同一ソースの作業ツリーをExpo静的exportし、Linux Chromium155で操作。後続コミットは証跡のみでUIコードは同じ。

## 結果

- [3案＋元の案の操作](results.json)：390/320px、Light/Dark、DOM文字2倍、Reduce Motion。4案×4段階、部分欠測/0/未記録、単位境目、選択案と期間/数値の独立、キーボード、ホーム/設定帰還を確認。pageerror/横overflowなし。
- 4つの直リンクと無効なlook値の初回フォールバックAを確認。表示案の選択でURLも更新する。
- Aは節目に対応する1〜4本の輪で、1日ごとの個数にしない。Bの粒/Cの面に量を割り当てない。新3案に進捗弧がないこと、全案で正確な時間数が共通であることを確認。
- [成長体験の回帰](growth-regression.json)：4段階・3境目、欠測/0、全期間累計と週/月内訳の独立、キーボード、タブ帰還、旧5ルートを同じ4表示条件で確認。
- ルート/独立デモのTypeScript、Lint: PASS。Jest34 suites/338 tests、demo基盤32、既存モデル12が合格。単位換算・fixtureは変更していないため、新たなスタイルの実装をなぞる単体テストは追加しない。
- expo-doctor: 18/20。exp.host DNS EAI_AGAINとReact Native Directory外部取得失敗は未完了。依存は変更していない。
- 静的export10ルート。最終headをpackageし、CIもそのheadを再ビルドして配信する。

## 画像

| 案 | Light390 | Dark390 | Light320 | Dark320 文字2倍 |
| --- | --- | --- | --- | --- |
| A 重なる輪 | [画像](light-390-rings-days.png) | [画像](dark-390-rings-days.png) | [画像](light-320-rings-days.png) | [画像](large-dark-320-rings-days.png) |
| B 粒の輪 | [画像](light-390-ticks-days.png) | [画像](dark-390-ticks-days.png) | [画像](light-320-ticks-days.png) | [画像](large-dark-320-ticks-days.png) |
| C まるい余白 | [画像](light-390-disc-days.png) | [画像](dark-390-disc-days.png) | [画像](light-320-disc-days.png) | [画像](large-dark-320-disc-days.png) |
| 比較 元のサークル | [画像](light-390-original-days.png) | [画像](dark-390-original-days.png) | [画像](light-320-original-days.png) | [画像](large-dark-320-original-days.png) |

年単位の例：[A](light-390-rings-years.png) / [B](light-390-ticks-years.png) / [C](light-390-disc-years.png) / [元の案](light-390-original-years.png)。

大きな数値を円の下へ移した部分：[A](rings-large-readout.png) / [B](ticks-large-readout.png) / [C](disc-large-readout.png) / [元の案](original-large-readout.png)。スクロールで数値/単位/端数へ到達でき、字を縮めない。

全て架空の記録。制限時間の用途や実際の有効活用を推定しない。月30日・年365日の概算は前回と共通。iPhone/Simulator/VoiceOver/実際のDynamic Type/OS制限・実データは未検証。DOM拡大は実機検証の代用ではない。

公開URLのログイン済みブラウザ観測は未実施。ローカル静的画面の検証とActions配信成功を区別する。本体/サイト/CI/依存/Accessは変更せず、今回の変更はdemo/のみ。
