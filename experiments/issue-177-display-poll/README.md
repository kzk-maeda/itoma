# 表示pollの実host追試（#177 / PR178）

本体 `ProductController.refreshForDisplay` と `refresh` のbodyをそのまま一時Swift packageへコピーする（入口のvisibilityだけ変更）。Apple monitor、restriction adapter、private取込/保護はfake、Control/Storage/Historyは同じcheckoutの実package。OS動作やFile Protectionの成立を証明しない。

```sh
python3 experiments/issue-177-display-poll/run.py --prepare /tmp/itoma-host --packages "$PWD/packages"
swift test --package-path /tmp/itoma-host --enable-index-store --jobs 2
```

Dockerの場合は`--packages`を同じcheckoutのmount先にし、生成packageのパスもmountする。Swift6.2.3、SQLiteが必要。schema/製品ソースや依存を変更しない。run.pyは抽出bodyのSHA256を出力するため、コピーした理想実装との混同を避けられる。

source `0f79c13390113f009e33682bee35ecced43c580d`、抽出body SHA256 `67557e8d2ebfd0ef7e0cc63f0a3defc16e6a463aa930c86539a5968440b05864`、Linux Swift6.2.3/SQLiteで3件PASS。

- 初回通常refresh後の固定context10poll：追加apply=0、snapshot全体/sequence変更=0、reflection boundary変更=0、元の観測/期限不変、backlog用import=10回継続。
- native lifecycle世代が変わる場合と、保護monitorが消えた場合は再反映を実行。
- private取込awaitで最初のrefreshを停止し、2件目のsnapshotが追加applyしないことを確認。await中にhost操作世代が変わるとstampを確定せず、次のpollが通常refreshへ戻る。

時間を15秒ずつ進めるfake uptimeとの対応・認可/zone/時計/期限/sequence変化・新process・不明/失敗・解除期限の正確な再制限は通常のControl packageの105 tests（この変更で4件追加）で確認する。この追試のfake clockは固定であり実時間15秒待ちではない。型/ビルド成立は同sourceの新しい署名不要iOS QAと分け、実機の通知配信は未検証として残す。既存 #154 の監査追試は旧sourceの問題を固定再現するもので、この変更の合格証拠へ読み替えない。
