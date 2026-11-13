# privateメタデータ応答の順序（#153）

状態: [#153](https://github.com/kzk-maeda/itoma/issues/153)の実装PRでレビューする契約。PR #151を含むmain `7642ebf657d97108e6825fef65dbe3a592a38625`を前提とする。JSの合成portでの検証と、iOSのFile Protection/背景復帰（#131/#135）を分ける。

## 3つの独立した順序

- **control sequence**: nativeの共有状態の版。新しいsequenceから認可、観測、grant、ruleの集合を採用する。同sequenceではrequestの開始順を比較し、遅い旧応答で新しい観測を上書きしない。
- **private revision**: nativeのhost-only RuleDetails保存の版。既知の最大revisionを`unavailable`中も保持する。本文が空の明示保存も現在版であり、古い非空の本文で置換しない。
- **request generation / lifecycle epoch**: JSでの取得の開始順とprivate再取得境界。private revisionを持たない`unavailable`も、この順序で比較する。到着時に世代を採番しない。

新しい`unavailable`の後に旧`ready`が届いても非表示を維持する。逆に、新しい`ready`の後に旧`unavailable`が届いても、新しいrevisionの証拠がなければ可用性を落とさない。新しい世代で既知のprivate revision以上を正常に読めば、同revisionを含めて復旧できる。低いrevisionの正常応答で既知の本文/可用性を置換しない。

同sessionの順序付き応答が新しいprivate revisionを示した場合は、古い世代/epochで本文を棄却しても最大revisionの証拠を保持する。現在表示中の本文がその最大revisionより古ければ、現在の可用性順序tokenを維持したまま本文を捨てて`unavailable`にする。到着時に新しいgenerationを採番しない。現在epochで採用可能なrequestが、その下限以上を読むまで再表示しない。例えば保存A開始→新read Bが`unavailable`→Aのrev3が遅着なら、本文を戻さず下限を3へ進める。その後の新read Cがrev2なら非表示を維持し、rev3以上の再読取で復旧する。

private部分が古くても新しいcontrol sequenceは採用する。逆に、新しいprivate部分と古いcontrol部分の応答ではprivateだけを採用する。本文は採用したcontrolのrule IDへ投影し、本文側のruleを追加しない。現在の本文に該当IDがなければ名前/目標を空にし、古いcontrolに付いていた文章へ戻らない。

## 所有者と入口

[`modules/itoma-native/src/control-snapshot.ts`](../../modules/itoma-native/src/control-snapshot.ts)の`controlSnapshots`が、**1つのJS runtime全体**の所有者。`beginRequest()`は`{ epoch, generation }`を返す。`withControlSnapshots(client)`はnative呼出し前にtokenを取得し、返った`response.snapshot`を`integrate(snapshot, token)`へ渡す。ScreenTime/Onboardingの公式clientとProvider注入portが同じ入口を使う。wrapperは冪等で、Providerが公式clientを二重採番しない。

成功/失敗/cancelled等の応答種別によらず、snapshotがあれば統合する。snapshotのないエラーはprivate可用性の観測ではないため、それだけでは既知の本文を消さない。制御状態の統合は受理やOS適用成功の捏造ではなく、応答本来のstatus/code/ref/impactsは維持する。

統合済みsnapshotはProviderの購読者へ通知し、戻り値にも同じ採用結果を返す。複数Provider、onboarding、直接clientを使うconsumer間で別の世代を持たない。`currentControlSnapshot`は統合済みsnapshotに付いた非公開の順序情報（WeakMap）を比較する。Onboarding結果画面の保持済み`resultSnapshot`も、最新Provider状態との比較で同じルールを使う。フィールドが同じでも新しい順序情報をProviderへ渡す。

この順序情報はnative DTO、保存、ログ、URLへ追加しない。コピー/spreadやJSON復元したオブジェクトは元のtokenを持たず、既知の順序付きprivate状態を上書きできない。より大きいcontrol sequenceだけは採用できる。キャッシュや別private DTOの非同期readを追加する場合は、元のtokenを統合入口へ渡す。I1でcontrol/privateを別executor/DTOにする場合もこの所有者とtokenを再利用する（#154）。

## epochと寿命

`src/state/control-snapshot.ts`がScreenTime/Onboarding Providerを参照カウントし、1つのAppState購読を所有する。activeからinactive/backgroundへ移る時点で`invalidatePrivate()`を呼び、保存済み名前/目標をすぐに隠す。activeへ戻る時にもepochを進め、各consumerの再取得を始める。inactiveからbackgroundへの遷移だけでは二重にepochを進めない。

無効化時には現在の本文Mapを捨て、既知のrevisionは残す。旧epochの応答はprivateを再表示できない。新しいprivate revisionの証拠は前述の下限へ反映し、より新しいcontrol sequenceを含む場合はcontrolを進められる。非active中に始まった応答もprivateの再表示根拠にしない。foregroundのreadは旧epochの進行中readへ合流せず、新しいrequestとして開始する。旧readの終了処理で新readの参照を消さない。

最後のlifecycle consumerが外れる時もprivateを無効化/受入停止し、次の購読時に現在のAppStateを確認する。購読のない間の背景/復帰を見逃しても、購読前のrequestを次の表示の根拠にしない。sessionは画面やProviderのremountでリセットしない。JS runtimeの終了で失われ、次のruntimeではnativeの現在状態を取り直す。native側の採番、永続化、他プロセス間の順序保証は追加しない。`reset()`はJestの独立fixture間だけで使う。private保存先を将来切り替える場合は、新しいsource/sessionの明示境界を設ける必要があり、Providerの再mountを代用しない。

## 編集入力と表示の分離

保存済み文章の非表示と、本人が編集中のRAM draftは別。失敗/epoch変更でRuleDetails編集画面、rule/unlock draft、Onboardingの未保存入力を消さない。Onboardingのdraft revision・submitted・安定IDとcoalescing writerの契約は既存の[初回設定](onboarding.md)に従う。本変更は`response.onboarding`を保存済みrule本文として統合しない。

UIの目的/保存状態は本人のデータと確認できた状態に限る（DESIGN §1/§3/§5、U01/U04/U05、UI01/UI16/UI21/UI26）。表示不能時は既存notice/再読取操作を使い、保存エラー時の入力を残す。画面構成・文言・操作順は変更しない。

## 検証の境界

Jestで両方向の遅着、正常復旧、revision下限、明示クリア、削除済みrule、control/privateの部分採用、同sequenceの旧観測、read/mutation/複数consumer、戻り値/保持済みresultSnapshot、epochをまたぐread、1つのAppState購読、保存エラー時のRAM入力保持を検証する。既存Onboardingの途中保存/完了復旧テストも継続する。

実装前にExpo SDK 58の[versioned index](https://docs.expo.dev/versions/v58.0.0/)と[llms index](https://docs.expo.dev/llms.txt)、React Native 0.88の[AppState API](https://reactnative.dev/docs/appstate)を参照した。AppStateは観測可能なJSの境界であり、iOSのデータ保護状態を保証しない。

JSのみの変更でSwift/bridge ABI/保存schemaの変更はない。これらの合成テストは端末lock、実際のbridge遅着、iOSの背景復帰やFile Protection、Screen Timeの適用、キーボード/VoiceOverの実機確認には数えない。
