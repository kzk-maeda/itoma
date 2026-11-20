# 実装タスクの進め方

対象はiOS・React Native/Expo/TypeScript・Swift・local-first。採用した設計は[システム設計](system/README.md)、判断理由は[ADR](adr/README.md)、現在の進捗・依存関係は[ロードマップ #20](https://github.com/kzk-maeda/itoma/issues/20)と各Issueを正本とする。

## 設計採用と検証を分ける

PR #36は2026-11-06 JSTに人間がmainへマージした。採用版は`6c17ac9a334a020a6833268a2f1a5762dc9aabc6`。ADR 0003〜0006、P1の解除前予定登録、P2の未来の切替による実効期限短縮を設計として採用する。

- #22〜#25の完了は設計決定の完了。Swift、保存、OS操作の実装完了を意味しない。
- #26はPoCの採否基準・手順、#8は実行環境・署名条件を確認する。環境調査と計画作成は並行可能。実機合格は対象ビルドの証跡で判断する。
- 純粋Swiftの型・評価・状態遷移はUI/Expo/SQLite/Screen Timeへ依存させず、Simulatorなしで単体テストする。本体/ExtensionへのリンクとiOSの成立は別途ビルド/実機で確認する。
- 80/100MiBとoutbox上限は実測前の暫定候補。UIガイドラインのP項目は別レビュー。未決定のUIやOSの保証を設計採用から推測しない。

## Issueとラベル

既存のMilestoneを継続使用し、原則として1つの実装Issueを1つのレビュー可能なPRへ対応させる。大きいIssueは`epic`と子Issueのチェックリストで残す。子Issueだけ終わっても、親の実機ゲートが残れば親は閉じない。

| ラベル | 意味・操作 |
| --- | --- |
| `Ready` | 設計・受入条件・検証方法が明確で、依存PRがmainに入り、実行に必要な環境が利用できる未着手の末端Issue |
| `In Progress` | 作業ブランチで着手済み。着手時に`Ready`を外して付ける。PR提出後も人間のマージまで維持 |
| `Blocked` | 依存、環境、製品判断のいずれかが未解決。本文に具体的な解除条件を書く。`Ready`と併用しない |
| `epic` | 子Issueと完了ゲートをまとめる親。自動実装の取得対象にしない |
| `priority:P0/P1/P2` | 既存の実行優先度。権限や設計前提を省略できるという意味ではない |

`Blocked`以外の未着手Issueも、条件確認が済むまでは`Ready`にしない。環境の棚卸しや小さいPoCは、その限定した作業の検証条件を満たせれば着手可能。実機が使えない状態で「実機での完了」を約束するIssueは取得しない。

## 着手からPRまで

1. `is:issue is:open label:Ready -label:"In Progress" -label:Blocked -label:epic`で候補を取得する。依存・最新main・既存の作業PRを再確認し、重複があれば取得しない。
2. `Ready`を外し`In Progress`を付け、Issue本文に作業ブランチを記録してからコードを変更する。現時点ではラベル更新の原子性を保証する仕組みがないため、同じrepoの取得処理は1つずつ実行する。
3. 最新mainから作業ブランチを作る。承認済みの前提に沿って実装し、仕様変更が必要ならIssue/ADRへ戻す。子Issueの境界を越える場合は先に作業を分割する。
4. `AGENTS.md`の型チェック・Lint・既存テスト・expo-doctorと、変更に必要なSwift/保存/OSテストを実行する。失敗・未実施・モック・実機を分けて記録する。
5. PRに対象Issue、採用版、検証SHA、結果、未検証事項を記載する。UI変更はU/P/UI IDと画像、native変更は対応ビルドと構成一致を記録する。
6. PR提出後は人間のレビュー/マージを待つ。自動マージ・配布・公開は行わない。実装Issueは要件を満たしたPRのマージで閉じる。環境不足なら未検証を完了扱いせず、阻害条件を残す。
7. 依存Issueの完了だけでなく決定/実装PRのmain反映と証跡を確認し、次の末端Issueを`Ready`へ移す。

## 自動取得の現在地

この変更はIssues＋Milestonesと`Ready`の運用を用意する。Codex routineやGitHub Actionsによる自動実装の起動は設定しない。ラベルを付けるだけで実装が自動開始する状態とは扱わない。

将来routineを設定するときは上記検索と取得手順を使い、同一repoでの同時取得を1つに制限する。PR待ち・Blocked・権限不足は自動で突破しない。routineの利用資格・起動頻度・認証設定は別に確認し、repoのラベル運用と実際の起動設定を分ける。

## 実装の順序

1. Expo依存整合、純粋Swiftの型/評価/解除期限。#8と#26の準備は並行。
2. 型付きbridgeとiOSビルドCI。保存とcommandのプロトコルはモックI/Oで先に検証し、実際のファイル保護・競合は別PoC。
3. 認可・対象選択・手動制限。Extensionビルド/共有保存と、OS期限APIの成立を小さいPoCで確認。
4. 予定登録→前提再検証→解除→期限後再制限を実機で接続。P1/P2、kill、旧callback、権限取消を検証する。
5. 未決定のUI条件をレビューしたうえで、理由/ダミー金額・ホーム状態・履歴を接続する。追加待機・回数制限・実課金は初版へ入れない。

各段階のIssue番号、現在のラベル、進捗は#20に集約し、本書にコピーしない。

## 依存関係の更新（Dependabot）

設定の正本は[.github/dependabot.yml](../.github/dependabot.yml)。デフォルトブランチへマージすると、次のバージョン更新を毎週月曜09:00（Asia/Tokyo）にチェックし、デフォルトブランチ向けのPRを作成する。PRは通常どおりCI・レビューを確認して人間がマージする。

| 対象 | 場所 | 通常更新PRの同時上限 |
| --- | --- | --- |
| npm | ルートのpackage.json/package-lock.json | 3 |
| GitHub Actions | .github/workflows内のuses | 2 |
| Docker | .github/docker/swift-tests.DockerfileのSwiftイメージ（タグ・digest） | 1 |

Swift Packageは現在ローカルpath依存のみ、modules/itoma-native/package.jsonは外部依存を宣言していないため、個別の更新ジョブは作らない。外部依存や別のlockfileを追加したら設定の監視対象も見直す。

npmは更新の単位を次のように分ける。通常のmajor更新とSwiftのmajor更新は、個別の作業として扱う。

| 対象 | 更新方法 |
| --- | --- |
| Expo SDKが指定する依存・React関連の型定義 | 通常のDependabot更新から外す。`expo`、`@expo/*`、`expo-*`、React/React Native関連、`eslint-config-expo`・`jest-expo`をSDK対応版へ手動で揃える |
| `cf` / `wrangler` | 更新候補を`cloudflare-toolchain`グループの同じPRへまとめる。`cf`のプレリリースも含めるため、グループの`update-types`は指定しない |
| その他のnpm依存 | `other-dependencies`グループでminor/patchを継続。Jest、Testing Library、TypeScript等もCIで確認する |

Expoの通常更新は、SemVerのminor/patchを無視する指定と共通のmajor除外を組み合わせる。依存名だけの全更新除外にはせず、セキュリティ更新を別途レビューできる状態にする。設定ファイルはSDKの対応表を自動追跡しないため、依存追加・SDK更新時に手動管理対象も見直す。

SDK関連の更新手順:

1. 利用するExpo SDKとそのバージョンの公式資料を確認する。SDKを上げる場合は、通常の依存更新と分けて変更範囲を決める。
2. `npx expo install <package>`で対応版を導入し、必要なら`npx expo install --fix`で揃える。`package.json`とlockfileを同じPRで更新し、変更された依存を確認する。
3. quality CIのSDK互換性チェックを通す。`EXPO_OFFLINE=1 CI=1 npx --no-install expo install --check`は、lockfileが固定したインストール済みSDKの対応表を参照する。オンラインの最新推奨版への追随は、依存更新とは無関係なPRの必須条件にしない。
4. AGENTS.mdのExpo Doctorを含む全体チェックと、依存変更を含むiOSビルド・該当する実機確認を行う。互換性ゲートを除外して更新を通さない。

Cloudflareは現在Build Output v0を使用する。対応する更新の組み合わせは`cf 1.0.0-beta.32` / `wrangler 4.161.0`。Dependabotは`cf >=1.0.0-rc.0`と`wrangler >=4.163.0`を候補から外す。Wrangler 4.163.0が出力するv1は、beta.32の`cf build`と、v0を読む`scripts/deploy-demo.mjs`では扱えない。v1へ進むときは、両CLI・成果物の参照・配信前の照合をまとめて移行し、ビルドと配信手順を再検証してから除外範囲を見直す。

更新候補が片方だけの場合、グループPRに含まれる更新も1パッケージになる。グループ化は両方の変更を強制する機能ではない。最終的な組み合わせは既存quality CIの`npm ci`と`npm run demo:package`で検証する。許可範囲内の更新でも、実際のパッケージ作成が失敗したPRはマージせず、対応版へ揃え直す。

Cloudflareの`versions`による範囲指定はセキュリティ更新にも適用される。範囲外に修正が必要な場合は、v1移行と合わせて個別に対応する。Expo等の`update-types`による通常更新の抑制とは区別する。

初回の失敗PR #236はSDKの対応版を維持する方針へ置き換える。Cloudflareの#237/#238は、対応する2依存を揃えた代替PRの全CI・レビューを確認し、人間がマージした後にクローズする。mainに設定が入る前に、旧PRの再作成を繰り返さない。

初回確認・運用:

1. 設定PRをデフォルトブランチへマージする。作業ブランチ上の設定だけでは、定期ジョブの有効化は完了しない。
2. リポジトリのInsights → Dependency graph → Dependabotで、3つの監視対象と初回チェックのログを確認する。必要なら対象ジョブの「Check for updates」を実行する。追加のAWS/OpenAI用SecretやPATは不要。
3. 更新PRのCIを確認する。npmでは`package.json`とlockfileの両方、Actionsでは変更された全workflow、DockerではSwiftテストとイメージdigestを確認する。ネイティブ依存の変更は、その変更を含むiOSビルドで追加検証する。
4. Dependabot PRの通常CIはread-only権限・Secretsなしで動く。エラーの解消のためにアプリのSecretをDependabotへ複製したり、PRコードを実行するjobへwrite権限を追加したりしない。

バージョン更新と、脆弱性アラート/セキュリティ更新は別設定。Settings → Advanced Security（UIによってはCode security）でDependency graph、Dependabot alerts、Dependabot security updatesの有効状態を管理者が確認する。設定ファイルだけでセキュリティ更新も有効になったとは扱わない。セキュリティ更新PRは週次バージョン更新のグループ・件数とは別に扱い、修正版への更新にSDK/major変更が必要なケースも手動で確認する。

公式資料: [バージョン更新の設定](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates)、[設定リファレンス](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)、[DependabotとActionsの権限](https://docs.github.com/en/code-security/reference/supply-chain-security/troubleshoot-dependabot/dependabot-on-actions)。
