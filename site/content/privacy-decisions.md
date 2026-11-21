# プライバシーポリシーの判断・確認事項（非配信）

公開前原案の正本は [#182「3. 公開文案」v3](https://github.com/kzk-maeda/itoma/issues/182)。正式配信前に、同Issueの「4. 本人の確定事項と公開前の残件」を配布版と照合する。サイトの `/privacy/` は準備状況、運営者、窓口、サイト配信について案内する。

## 現在の運営方針

- 運営者は **Kazuki Maeda**。正式サイトは https://itoma.app/ 、ポリシーの掲載先は https://itoma.app/privacy/ 。初回配信は日本向け。
- 問い合わせと開示・削除請求は **support@itoma.app**（Gmail）で受け付ける。問い合わせと運営者が書き出した診断情報は、調査・対応に必要な期間だけ保管し、不要になったら削除する。法令等の例外は#182の原案に従う。
- Cloudflareのログ・Access、Gmailの保管・削除、Apple診断の利用・書き出し等の確認事項は#182で管理する。住所等の提示方法と制定日も同Issueで確定する。
- 配布版のSDK・通信は [#183](https://github.com/kzk-maeda/itoma/issues/183)、保持・削除・バックアップの実機確認は [#135](https://github.com/kzk-maeda/itoma/issues/135)・[#173](https://github.com/kzk-maeda/itoma/issues/173) で照合する。正式配信前に本文を掲載し、アプリ内リンク・App Privacy回答・匿名閲覧を確認する。

## 任意の支援を導入する場合

[設計引き継ぎ #280](https://github.com/kzk-maeda/itoma/issues/280) の初版案は、設定からの任意の単発支援。[デモ #279](https://github.com/kzk-maeda/itoma/pull/279) は模擬決済で、現在のLP・プライバシー案内に支援購入や取引データの収集を追加する段階にはない。

支援を含む版の配信前に、Appleが処理する支払手段、アプリが端末内で検証する取引情報、運営者がApp Store Connectや問い合わせで実際に扱う情報、SDK・サーバーへの送信を区別する。実装に即して目的・保存先・保持／削除を記録し、#182の本文と#183のApp Privacy回答を更新する。LPは使い方とフッターのポリシー・窓口を維持する。
