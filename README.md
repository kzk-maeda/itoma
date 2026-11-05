# ITOMA（いとま）

無意識のスマートフォン利用を減らし、自分の時間を取り戻す iOS アプリです。
React Native + Expo + TypeScript を使い、OS 連携は Swift / Expo Modules API で開発します。
MVP は Local-first とし、バックエンド・独自認証・実課金は導入しません。

背景・確定方針は [引き継ぎ資料](docs/ITOMA_CODEX_HANDOVER.md)、開発ルールは [AGENTS.md](AGENTS.md) を参照してください。
UI・操作・文言の設計判断とレビュー基準は [DESIGN.md](DESIGN.md) にまとめています。
MVP仕様・状態モデル・責務・保存・PoC計画と検討Issueの入口は [システム設計](docs/system/README.md) です。未決定事項はIssue、仕様は設計資料、重要な判断理由は [ADR](docs/adr/README.md) で管理します。

## セットアップ

CI と同じ Node.js 24 と npm を使用します。

```bash
npm ci
```

iOS のローカル開発には Mac、Xcode、インストール済みの iOS Simulator ランタイムが必要です。

```bash
npm run ios
```

開発ビルドをインストール済みで JavaScript / TypeScript のみを変更する場合は、次を実行して `i` で Simulator に接続します。開発中はサーバーを起動したままにします。

```bash
npx expo start --dev-client --localhost
```

ネイティブ依存関係や Swift の変更後は開発ビルドを作り直します。
`ios/` は Git 管理外の生成物です。ネイティブ設定は Expo 設定・config plugin、独自機能はローカル Expo Module で再現可能にします。既存構成を無条件に初期化しないでください。

## 品質チェック

```bash
npx tsc --noEmit
npm run lint
npm test -- --ci --runInBand
npm run test:demo
npx expo-doctor
```

`npm test` は Jest / jest-expo による一度の実行です。開発時の監視は `npm run test:watch` を使用します。
ホーム画面のテストは React Native Testing Library を使い、モックのアプリ・モード選択、保存、キャンセルを検証します。OS の制限機能を検証するものではありません。

GitHub Actions の `quality` ジョブは main への push と PR で依存関係のインストール、型チェック、lint、テストを実行します。
`expo-doctor` はローカルで実行し、結果を PR に記載します。オンライン照会の失敗と依存関係の不一致は区別してください。

## 現在の実装と未設定事項

- ホームはアプリとモードを選択できるモックです。設定は画面内のメモリに保持され、永続保存・OS 制限は行いません。
- FamilyControls / ManagedSettings / DeviceActivity、Swift モジュール、App Extensions、App Groups は未実装です。
- iOS ネイティブビルド・UI 自動操作・証跡収集の CI は未整備です。
- Expo 接続、EAS ビルド設定、クラウド Simulator の利用資格、Apple の署名・Family Controls 権限は別途確認が必要です。
- Simulator の UI 確認と iPhone 実機での Screen Time 検証は分けて扱います。

## PR の運用

Webデモはブランチごとに `/demos/<branch-key>/` へ分離します。`npm run demo:info` でそのブランチのURLを確認できます。[閲覧・更新手順](docs/demo-environment.md) を参照してください。`Deploy demo` workflowがmain以外のブランチへのpushで検証・ビルド後にCloudflareへ配信します。初回は[認証設定](docs/demo-environment.md#認証設定初回のみ)が必要です。ローカル手動配信も利用できます。GitHub上のブランチ削除では `Cleanup demo` が専用Worker・Routeを自動撤去します。PRを閉じるだけでは削除しません。

作業ブランチから PR を提出し、人間が確認・マージします。
PR テンプレートにテスト結果、対象コミット、UI 変更時の画像、未検証事項を記録してください。
ネイティブ変更はその変更を含むビルドで検証し、古いビルドの結果は `stale native build` と明記します。
秘密情報をログ・ソース・PR に記載しないでください。

## デモ環境一覧

ドメイン直下の一覧から、配信中のブランチデモと変更概要を確認できます。[一覧の判定・更新・初回配信手順](docs/demo-environment.md#ドメイン直下のデモ環境一覧)を参照してください。
