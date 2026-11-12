# 未変更ルールの画面確認

対象: [#152](https://github.com/kzk-maeda/itoma/issues/152)、[契約](../../system/rule-preview-noop.md)。DESIGN原則1/3/5、UI07/UI11/UI14/UI21をcomponent/portable nativeで扱い、ここでは新しいno-change状態のWeb表示・操作到達性を確認する。

製品ソース`88901783872ab53f394640bcf802cce16e1f1fad`を一時worktreeへcheckoutし、実際のRuleEditorScreen/ScreenTimeProvider/Notice/Button/テーマを使用した。変更したのは記録した一時layout/route/native label代替の3ファイルだけ。fixtureのnative応答は合成データで`ok`・確認refなし。実際のnative意味比較やScreen Time成功をWeb fixtureで証明しない。

Linux Chromium 155.0.8059.79、固定時計2026-11-09T21:30:00Z、Reduce Motionあり。390×844のLight/Dark、320×800の1.5倍文字で「内容を確認する」→「変更はありません」→有効な「保存したルールに戻る」を確認した。3条件とも横overflow/JS例外なし。確認用保存ボタンなし。呼出しは各条件`snapshot`と`previewRule`だけで、`commitRule`なし。

PNGはローカル`/tmp/itoma-152-visual/`だけに保持し、この記録へは画像を含めない。各画像のSHA-256、正確な製品ソース/fixtureのSHA-256、実行した3つのJavaScript bundleのバイト数/SHA-256、条件、native未検証の区別は[manifest.json](manifest.json)にある。画像はviewportの下へ続くscroll内容の全体exportで、祖先DOMのclipを外した。大文字はDOM font-size/line-heightを1.5倍にした近似で、iOS Dynamic Type/キーボード/VoiceOverの合格ではない。

再現時は対象commitの使い捨てcheckoutを用意し、`proof-layout.tsx.txt`→`src/app/_layout.tsx`、`proof.tsx.txt`→`src/app/proof.tsx`、`proof-applications.tsx.txt`→`src/components/flow/applications.tsx`へコピーする。既存依存を用意して`CI=1 node_modules/.bin/expo start --web --port 8142`を実行する。`capture.mjs.txt`を一時`.mjs`として実行し、必要なら`ITOMA_NOOP_SOURCE`（未変更製品checkout）、`ITOMA_NOOP_FIXTURE`（fixture checkout）、`ITOMA_NOOP_OUTPUT`（ローカル出力先）を指定する。PlaywrightとChromiumが必要。一時route/代替を製品へ残さない。

Simulator・実機は未実施。nativeを含む署名無しiOSビルドは統合PRのCI、実機grant継続は#131で別に判断する。
