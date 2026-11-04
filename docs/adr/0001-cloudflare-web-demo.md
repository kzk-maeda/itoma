# 0001: 仮説検証用WebデモをCloudflareで段階導入する

- 状態: Proposed
- 検討Issue: https://github.com/kzk-maeda/itoma/issues/28
- 自動撤去の追加実装Issue: https://github.com/kzk-maeda/itoma/issues/32
- 自動撤去の実装PR: https://github.com/kzk-maeda/itoma/pull/33
- 決定PR: 初期提案 https://github.com/kzk-maeda/itoma/pull/29 （マージ済み、状態はProposed）。ブランチ別パス・Actions配信は https://github.com/kzk-maeda/itoma/pull/30 でレビュー
- 採用日: 未定（人間のレビュー・採用PRのmainへのマージ後に記載）
- 関連・置換するADR: なし（初回）
- 検証状況: 一部実施。ユーザー依頼の限定セットアップでWorkers静的配信・本人認証・匿名アクセス拒否を確認。CI配信・メンバー追加・OS実機動作は未検証。状態はProposedのまま

## 背景と解決する問い

ITOMAはiOS向けReact Native / Expo / TypeScriptとSwiftを使うLocal-firstアプリである。この方針は変更しない。
画面構成・文言・解除フローの理解を、複数人がスマートフォンやPCから同じURLで確認できるデモ環境を用意したい。
デモの確認結果は製品仕様を決める材料とし、Screen TimeのOS動作確認とは分ける。

初期提案時点では単一のExpoアプリで、`src/app/`、React Native Web、メモリ上のモック設定、型チェック・lint・テストのCIが存在する。`app.json`の`web.output`は`server`で、Cloudflare設定・配信CIはない。
Cloudflare CLIのインストールとユーザーによるログイン完了の申告はあるが、対象アカウントの配信権限やプレビューの利用条件は確認していない。

判断する問いは、初期デモを何から作り、どこへ配信し、ネイティブ本体とどこで分離するかである。Notion連携・自律実装基盤・monorepo移行を同時に必須化しない。

## 選択肢と比較基準

複雑さ、再現・復旧、プライバシー、OS制約、検証可能性、費用・認証の運用を比較する。

| 選択肢 | 複雑さ・復旧 | プライバシー・OS制約 | 検証可能性・判断 |
| --- | --- | --- | --- |
| 現状維持（ローカルWeb／Simulatorのみ） | 追加運用なし。手元のコミットへ戻せる | 外部配信なし。Simulatorと実機の限界は残る | URLによる非同期の共同確認が難しく、今回の目的を満たさない |
| 既存Expo WebをCloudflare Workers Static Assetsで配信 | 初期の移動・複製が少ない。成果物・SHAを記録して再配信する。cfとExpoの組み合わせはPoCが必要 | 静的デモに限定し、製品のバックエンドは不要。公開範囲を別途設定。OS機能は模擬のみ | **第一候補**。既存画面を利用して共有フローを小さく検証できる |
| 既存Expo WebをCloudflare Pagesで配信 | Git連携・プレビューの選択肢。cfのWorkers用ビルド／配信とは別の設定・コマンド確認が必要 | 公開URL・アクセス制御の管理が必要。OS機能は模擬のみ | 有力な代替。Workers案の配信・アクセス制御・費用条件が合わなければ再比較 |
| 最初からmonorepoと独立Webアプリを作る | デモを隔離しやすいが、移動・依存解決・CI・Expo設定を一度に変更する。復旧対象も増える | デモ専用状態を本体から分離できる。OS動作は検証できない | 初回共有までの変更が大きい。デモ固有機能を増やす段階で別判断 |

Expo HostingやクラウドiOS Simulatorも選択肢だが、今回のCloudflare上のWebデモ準備とは分ける。クラウドSimulatorへの接続をWeb共有の前提にせず、実機PoCを置き換えない。

## 提案または決定

以下は**提案**であり、公開・サービス作成・費用発生の実施承認を意味しない。

### 1. 既存Webから始め、静的デモを配信する

- 初期は既存Expo Webを利用する。静的出力のビルドと直リンク・リロード・画像読込を確認してからCloudflare配信を設定する。
- 配信先の第一候補はWorkers Static Assets。静的ファイル配信に限定し、独自API・DB・認証バックエンド・Codex実行Workerは追加しない。
- 現在の`web.output: server`をそのまま静的ホスティングへ置けば動くと仮定しない。デモ用出力設定の分離方法を実装PRで示し、iOS設定を保持する。API routes / SSRは初期デモに含めない。
- cfは実装時にプロジェクト依存として版を固定し、ロックファイルで共有する。現在のグローバル版やCIの`latest`だけに依存しない。
- cfの自動設定は依存関係や設定を書き換える場合がある。設定未作成のリポジトリで`cf init`・ビルド・dry-runを無条件に実行せず、別ブランチで差分をレビューする。

### 2. デモと製品の検証範囲を分ける

- デモで確認するのは、情報の理解、文言、遷移、入力、反映・キャンセル、模擬状態の説明である。模擬の認可・制限・通知は画面上でも明示する。
- FamilyControls、ManagedSettings、DeviceActivity、Extension、JS停止中の再制限は、既存の実機PoC計画で確認する。デモの合格をOS動作の合格にしない。
- 初期は閲覧者ごとにメモリ内の状態を持ち、他の閲覧者へ変更を伝播しない。シナリオを追加する場合は初期状態へ戻す操作と、仮説ごとの再現手順を用意する。
- 実際の選択トークン・理由入力・利用履歴・個人情報は持ち込まず、固定の模擬データを使う。共有の入力保存・分析SDK・実課金は追加しない。
- 将来デモ専用の状態切替やOSモックが増えるときは、`apps/mobile` / `apps/demo-web`への分離を別設計Issueで判断する。共有候補はデザイントークンとOS非依存の型・純粋なロジックとし、本体からデモへの依存を作らない。

### ブランチ名に基づくパス分離（今回の更新提案）

ユーザーが求める単位は、デモごとのGitブランチと独立した確認環境である。固定Workerへ全ブランチを上書きする初期セットアップだけでは満たさない。

- URLは同じホストの `/demos/<branch-key>/` とする。branch-keyはブランチ名を小文字ASCIIのslugへ変換した先頭36文字と、元の名前のSHA-256先頭12桁を結合する。`feat/a` と `feat-a`、大文字小文字、長い名前を区別するためで、フルのブランチ名もmanifestに記録する。ハッシュ衝突が判明した場合は配信を止めて識別方式を見直す。
- 同じブランチは同じURLとWorkerを更新する。別ブランチは別Workerと2本のRoute（パスそのもの／パス配下）を持ち、ほかの成果物やRouteを更新しない。
- 共通ホストのCustom DomainとAccessを再利用する。ルートの初期デモWorkerは維持し、サブドメイン・DNS・Accessアプリをブランチごとに増やさない。RouteがCustom Domainより優先される構成を使う。
- Expoの `experiments.baseUrl` を配信パスにし、exportしたHTML・JS・画像を同じパスのディレクトリへ配置する。通常の静的配信で直接アクセス・再読み込みを検証する。
- `assets.basePath` でもローカル配信は成立したが、対象アカウントの本番APIでは100343「非ルートbase_path未有効」で拒否された。採用には依存させず、成果物のディレクトリ配置で対応する。
- 同一オリジンなので、パスはセキュリティ境界ではない。現在のメモリ状態は閲覧者・ページごとに独立するが、将来localStorageやIndexedDBを使うならbranch-keyを保存キーの名前空間に含める。信頼できない他者のコードを同じホストで実行しない。
- 成果物と現在のbranch・SHA・Worker名・Route・basePathが一致しなければ配信を拒否する。別ブランチへ切り替えたら、同じSHAでも再ビルドが必要。
- CIのdetached PR checkoutではGITHUB_HEAD_REFを利用する。ローカルのdetached HEADやタグを勝手にブランチへ割り当てない。
- 終了時は `demo:info` で対象ブランチのWorker・Routeを確認し、該当する2本のRouteとWorkerを削除する。共通ホスト・Access・他ブランチは残す。削除イベントによる自動撤去は下記の追加提案で扱う。

| 比較案 | 判断 |
| --- | --- |
| ブランチ別サブドメイン | オリジンを分離できるが、今回のパス分離の希望に合わない。個別権限や未信頼コードが必要なら再検討 |
| 1つのWorkerのassetsに全ブランチを集約 | 毎回全成果物の保持・再取得・競合制御が必要になり、更新・削除で別デモを失うリスクが増える |
| **共通ホスト＋ブランチ別Worker/Route** | **今回の提案**。一つのデモだけをビルド・配信でき、別デモの成果物を扱わずに更新・削除できる。Worker数・Route数の上限管理は増える |

### GitHub Actionsでのブランチ配信（追加提案）

- ユーザーの追加依頼により、main以外のブランチへのpushで、Actionsが型チェック・lint・テスト・デモビルド後に配信する。PRの有無には依存させず、mainの固定デモは上書きしない。
- CloudflareのGit連携（Workers Builds）も候補だが、独自のbranch-key・Worker/Route・配信照合を既存スクリプトで一元管理できるActionsを選ぶ。Cloudflare側に別の自動ビルドは設定しない。
- ローカルの対話ログインを流用せず、専用APIトークンをGitHub Secretに保管。配信先アカウントはGitHub Variableへ明示する。トークンは配信ステップに限定し、既存の資格情報なしPR CIは維持する。
- 新規Workerの作成には対象アカウントのWorkers product Admin、Routeの更新には対象zoneのWorkers Routes Writeが必要。将来のWorkerを個別指定できないため、トークンをブランチ名の接頭辞だけに制限できるとはみなさない。リポジトリへpushできる人のコードを信頼する運用とし、fork PRへ配信資格情報を渡さない。
- 同一ブランチの配信を直列化し、配信前にGitHubの先頭SHAを照合する。進行中のアップロードを後続pushで中断せず、古い実行の再実行はスキップする。
- URL・配信SHA・Worker名をActions Summaryへ残す。Version IDは配信ログに残す。メンバー追加・Access設定変更は自動化せず、削除は次の追加提案で扱う。
- 認証設定手順の正本は [demo-environment.md](../demo-environment.md)。アカウント変数は登録済み、専用トークン登録後、Actions実行 `41828277172` の再実行でSHA `6103338` の本番配信成功を確認した。ADRはProposedを維持する。

### Gitブランチ削除時のデモ自動撤去（追加提案、Issue #32）

ユーザーの依頼により、GitHub上のブランチ削除をデモ環境の終了条件とする。今回もADRはProposedのまま実装・検証結果を記録する。

| 案 | 判断 |
| --- | --- |
| 手動撤去だけを継続 | 操作は少ないが、不要Worker/Routeが残りやすく、今回の自動削除の要望を満たさない |
| PRのclose/mergeで撤去 | 継続利用するブランチの環境も失い、PRなしのデモを扱えない |
| **GitHub deleteイベントで撤去** | **今回の提案**。環境の単位であるGitブランチと寿命を合わせる。タグやdefault branchは除外 |
| 定期的な全環境の照合・削除 | イベント漏れを補えるが、全Workerの列挙・保持期間の判断が増えるため今回の範囲外 |

- 削除されたブランチではなく、default branch上の撤去コードを実行する。配信とはブランチ単位のconcurrencyを共有し、途中のアップロードを強制中断しない。
- 削除前と各変更前にGitHubの同名ブランチの不存在を確認。再作成されていたらスキップする。確認APIの失敗は削除許可とみなさない。
- 同じbranch-keyの専用Workerと2本のRouteだけを対象にし、所有先と既存参照を検査。共通Worker・Custom Domain・DNS・Accessを保持する。別の参照があるWorkerの強制削除は行わない。
- CloudflareのWorker/Route APIへ、既存のGitHub Secretのトークンを使ってアクセスする。cf CLIのRoute操作を推測せず、公開APIで対象IDを指定する。追加依存・製品バックエンドは不要。
- 既に存在しないリソースへの再実行と部分失敗からの復旧を可能にする。手動実行はdry-runを標準とし、削除済みブランチだけを扱う。mainへの導入前に削除された環境は自動では遡及しない。
- ローカルのAPI mockテストで削除範囲・共有資源保護・再作成・APIエラー・再実行を検証する。実際のdeleteイベントによる撤去はmainへマージ後に確認が必要で、計画を成功実績とは記載しない。

参考: [GitHub deleteイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#delete)、[Worker削除API](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/delete/)、[Route削除API](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/delete/)。確認日: 2026-11-04。

### 3. 検証結果をIssue・PRに結び付ける

- 仮説はGitHub Issueに記録する。問い、受入条件、模擬する範囲、操作手順、採用・見送りの結果を残す。
- プレビューには仮説ID／Issue番号、commit SHA、デモとわかる表示を付ける。共有記録にはデプロイIDとその成果物を特定できるURLも残す。更新されるブランチURLだけを証跡にしない。
- 最初の配信は明示的な手動実行から開始する。成立確認後に、既存quality CIの成功と承認を条件とするPRプレビューを検討する。mainへのマージと外部公開を同一視しない。
- 採用した仮説は本実装Issueへ要件を整理し、Webデモと異なる権限・保存・エラー・実機受入条件を明記する。試作ブランチを製品へそのまま採用しない。
- Notionで仮説を整理することは将来候補とし、今回の前提にしない。導入時はGitHubとの正本・相互リンク・起票の重複防止を別途決める。Notion連携やCodex SDKの無人実行基盤は対象外。

### 4. 配信前の条件を実装Issueで解決する

- 対象アカウント、プロジェクト名、費用条件、共有対象者とアクセス制御を確認する。非公開で共有できることを確認するまではリモートへ配信しない。
- プレビュー用ホストだけでなく、既定ホスト・別名・過去URLの到達範囲も確認する。閲覧用アクセス制御はホスティング側で行い、アプリ本体の独自認証には持ち込まない。
- CIには最小権限の専用APIトークンと明示的なアカウント指定を用意する。対話ログインの資格情報を流用しない。秘密は配信ステップだけに渡し、未信頼PRのコードに触れさせない。
- 成果物はビルドと配信で一致させる。プレビューの作成上限・保持期間・削除・旧版への戻し方を実装時に定め、削除成功や費用ゼロを未確認のまま保証しない。

## 理由と影響

既存の画面とテストを再利用し、ネイティブ機能の実装前でも体験の理解を確認できる。最初から全面的なmonorepo化や別のWebフレームワークを導入するより、初回の配信・運用に関する不確実性を小さくできる。

一方、初期は本体とデモが同じソースなので、デモ専用コードの混入やネイティブ依存によるWebビルド失敗を監視する必要がある。共有を維持するコストが増えた時点で分離する。
Workersは静的配信先として使う案で、アプリのLocal-first方針は変えない。配信・権限・秘密・費用・削除の運用責任は増える。

初期提案PRでは実装・配信を行わず、後続のユーザー依頼でデモ用ビルド設定・Cloudflare配信・証跡記録を追加した。追加依頼によりActionsでのブランチ配信を用意する。再現シナリオの拡充は後続検討とする。
本体のMVP・ドメイン・保存・Swift責務の提案は確定させず、[#21](https://github.com/kzk-maeda/itoma/issues/21)〜[#26](https://github.com/kzk-maeda/itoma/issues/26)の設計を継続する。[#8](https://github.com/kzk-maeda/itoma/issues/8)の環境確認と[#18](https://github.com/kzk-maeda/itoma/issues/18)のクラウドQAとは検証範囲を分ける。

## 証拠と未解決事項

確認日: 2026-11-04（JST）。リポジトリの基準SHA: `25b05d0120d24d1e1aeca6103b3b3235e83685df`。

- 既存CI・Web設定・モック画面をコードから確認。過去の[ホームレビュー](../itoma-home-review.md)はChromium / React Native Webの記録であり、Cloudflareの配信記録ではない。
- ローカルで`cf --version`は`1.0.0-beta.27`。ログイン成功はユーザー確認。提案作成時点では対象アカウント・配信・アクセス制御等は未確認だった。後続の限定PoC結果は下記に記載する。
- [Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/): 同一ホストのRouteがCustom Domainより優先される。
- [Serving a subdirectory](https://developers.cloudflare.com/workers/static-assets/routing/advanced/serving-a-subdirectory/): 比較したbasePath機能。対象アカウントでは本番利用できなかったため使用せず、実ファイルの配置で対応する。
- [Expo SDK 58 baseUrl](https://docs.expo.dev/versions/v58.0.0/config/app/#baseurl): バンドルされたリソース・リンクの配信パス設定。実験的設定で、ビルドと画面操作の確認が必要。
- [cf projects](https://developers.cloudflare.com/cf/projects/): Workers用のビルドと配信、自動設定の挙動。Expoとの直接互換を実証する資料ではない。
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/): 静的配信の候補。今回のアカウントでの成立・アクセス制御は別確認。
- [cf CI](https://developers.cloudflare.com/cf/ci/): 版固定・非対話認証・成果物を使う配信の参考。cfはbetaであり、実装時に仕様を再確認する。
- [Pages previews](https://developers.cloudflare.com/pages/configuration/preview-deployments/): 代替案のURLとアクセス制御。Pagesの機能をWorkersにも同じように使えるとは仮定しない。
- [Expo static rendering](https://docs.expo.dev/router/web/static-rendering/): 静的出力の参考。提案作成時点では未実施。後続の限定PoC結果は下記に記載する。

### 2026-11-04の限定セットアップ結果（採用判断とは別）

ユーザーから、ADRレビューと並行して現在のアプリをCloudflareへデプロイし、閲覧者はまず本人だけに限定する明示的な依頼を受けた。これを限定的なセットアップ・PoCとして実施し、ADRの状態や採用日は変更しない。

- 対象コミット: `ccbf7c22a78a4042ae782002f1fc27c9a552c9f7`。main `25b05d0` のアプリを維持し、配信設定を追加。成果物のdirty=false。
- Expo静的exportとcfのWrangler委譲ビルドが成立。cf `1.0.0-beta.27` / Wrangler `4.157.0`。
- Workers Static Assetsで https://itoma-demo.kzk-maeda.com に配信。Worker Version ID: `168b1c3f-a65a-4a32-88a1-c3392d62fde9`。
- 既存Zero Trust組織・メールワンタイムコードIdPを利用し、本人メール1件だけの専用Accessポリシーとアプリを作成。workers.devとversion previewは無効。
- ブラウザ相当の匿名GETでHTML・JS・画像・ビルド情報が302でAccessへ転送されることを確認。認証済みブラウザで本人identityと配信SHA一致、デモ画面の表示を確認。
- 作成リソース・設定・操作手順の正本は、セットアップPRの `docs/cloudflare-resources.md` / `docs/demo-environment.md` に記録する。今回のセットアップPRで取り込む。

CIでの配信資格情報、自動PRプレビュー、拒否対象メールの実試験、複数メンバー、直リンク・再読込の全経路、復旧・削除の実施、費用・保持期間の運用、monorepo化は残る検討事項である。実機PoCは進めていない。恒常運用への採用時にはこれらの範囲・採否条件をレビューし、必要に応じて再比較する。

### ブランチ別パスの限定検証

- 配信コミット: `5313ad1531a5bd424faf47714d1826c1f713c059`、dirty=false。
- `feat/branch-path-demos` と `demo/path-isolation-check` の2ブランチから、共通ホストの異なるパスへ別Worker・各2本のRouteを配信。2番目の配信で最初のWorkerの配信日時が変わらないことを確認。
- 初回Worker作成直後のcf betaの10007/404・null tagエラーは、APIでWorkerを確認した後に同じ成果物を再実行して解消。恒常運用時のCLI安定性は継続確認する。
- 両パスのHTML・直リンク・manifest・JS・PNGの匿名GETはAccessへ302。サブパスでの静的配信はローカルで確認したが、新しい本番パスの本人ログイン後表示は未確認。
- 各URL・Worker ID・Version ID・設定・残る制約は [リソース一覧](../cloudflare-resources.md) を正本とする。本人限定Accessとルートの初期デモを維持し、自動配信・自動削除は追加していない。

## 再検討条件

- Expoとcfの接続に独自サーバーや大きな本体変更が必要になる。
- 必要なプレビュー・アクセス制御がアカウントや費用条件に合わない。
- デモ専用機能・OSモックが本体へ混入し、iOSの検証・ビルドを妨げる。
- 同時に検証する仮説が増え、単一アプリでのシナリオ・版管理が難しくなる。
- 本物のデータ、共有保存、認証、外部連携が必要になる。
- cfのbeta仕様が変わり、版固定でも運用を維持できない。
- Worker / Route数が利用可能な上限に近づく、または共通オリジンでの分離では不十分になる。

変更時はこのADRの理由を消さず、新しい設計Issue・ADRから関連付ける。
