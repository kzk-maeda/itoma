# 未変更の時間帯ルールを保存し直す

[#152](https://github.com/kzk-maeda/itoma/issues/152) / [監査 #150 F3](https://github.com/kzk-maeda/itoma/issues/150)。本人の対応依頼に沿う実装契約。PRでレビューする。Swift/SQLiteとcomponentの検証を、変更nativeを含むiOSビルド・実機でのgrant継続と区別する。

## nativeで変更の有無を確かめる

`ProductController.previewRule`はportableな`ItomaControl.RulePreviewService`を呼ぶ。サービスへ実際の共有Repository、現在の認可/context、選択確認済みref、識別子生成、変更候補の影響評価portを注入する。AppleのPicker/具象singletonをテストへコピーせず、製品と同じ入口で入力検証・比較・候補受理を追試する。

writer内の最新snapshotに対して、expected policy revision、指定されたrule UUIDの構文/存在、selection UUID/存在/非空/50件上限、曜日、分、翌日を含む有効な時間区間を先に検証する。誤った既存rule IDを新規作成へ変換しない。削除には既存ruleが必要。入力・所有権・候補の検証に失敗すれば、以前の候補を取消さない。

既存ruleとの意味比較には曜日集合、開始分、終了分、翌日offset、有効状態、解除条件を使う。対象はnativeが保存したimmutable `TargetRef`集合を照合する。Pickerを選び直してselectionRefが変わっても、同じ集合と証明できれば保存済みのRule全体を保持する。件数、表示名、opaque payloadのバイト列を同一性の証拠にしない。名前と行動目標は独立したprivate情報で、この比較に含めない。

同じ条件ならnativeは`status: ok`、確認用`ref`なしで応答する。新しいcommand/candidate、ruleVersion/policyRevision、grantの状態・初期/実効期限、期限予定、RestrictionAdapter適用、PolicyScheduleCoordinator.prepareを作成/更新しない。候補影響評価portも呼ばない。古いRuleのversionだけ据え置いて異なるselectionRefを書き込むことはしない。以前の候補がない通常のno-opではsnapshot sequenceも不変。

時間・曜日・翌日・有効状態・対象・解除条件に差分がある場合、新規作成、削除は従来通りversion/CAS・影響確認・明示確定へ進む。新しい期限の登録、再検証、policy有効化、古い保護予定の取消の順序は既存のCommandServiceを使う。no-opのためにCoreのversion変更時のgrant失効や`PolicyCandidate.validate`を緩めない。

## 認可と選択の確認

no-opと返すには現在の認可がApprovedであることを確認する。認可取消後の`awaitingReauthorizationConfirmation`では、現在のPickerで確認したselectionが必要。旧保存データや同件数だけでは確認済みにしない。新しく確認したselectionと旧Ruleのimmutable対象集合が等しければ、保持した旧selectionRefへprocess内の確認済み事実だけを引き継ぐ。Activationは確認待ちのまま、ご自身の明示的な「再開」を別に要求する。失効したgrantは復活させない。

未認可で差分のある設定を保存できる既存の契約は維持する。保存とOS適用は別であり、no-opはOSの反映成功を意味しない。認可取消epochの記録と表示pollによる現在状態の再評価はこの編集処理とは別。pollのOS副作用は #154 / 監査F2で扱う。

## 以前のpreviewを取り消す場合

編集画面の確認用reviewと、以前受理されたpreviewのrefを分離する。編集するとreviewを無効にするが、Providerの`rulePreviewRef`は画面の再mountを越えて保持する。再preview/破棄時に既存requestの`ref`として渡す。新しい編集フローの開始時には消す。

nativeはregular editor/onboarding/recoveryの所有者を区別し、要求ref・保存candidate・現在revisionを照合する。取消可能なのはPending、または未有効化のFailed/Uncertain command。Scheduling/Applying・有効化済み・取消済みpreviewは拒否する。refなしのcancelは何も所有しない。別フローの候補は取消/置換せず、明示refの不一致・取消済みpreviewの再送は拒否する。変更して元に戻した場合だけ、同じフローの未反映候補を取消す。この取消ではsnapshot sequenceが進むが、新しいcommand/candidateを作らず、policy/version/grant/予定は変更しない。取消と新しい変更候補の受理は同じwriterで行い、失敗時は一緒にrollbackする。

policyを保存できてもOS適用が失敗した場合、返されたsnapshotがpreviewへ送ったexpectedRevisionから進んでいれば、画面は古いreview/refを消す。このbaseはeditor/削除元が入力と同時にUI draftへ保持し、任意のresponse snapshotや後から進むpollのrevisionに依存しない。入力と失敗表示を保持し、最新の保存済みpolicyを再確認する。古い候補をbase+1として再使用しない。

candidate受理後の影響評価だけが失敗した場合は、受理したrefを既存のerror応答へ含める。nativeはその候補の所有権を保持するが、確認内容は未取得として扱い確定を拒否する。画面もreviewを消し、新refだけを保持する。本人は同じ入力の再確認、編集、破棄へ進める。別processでpolicyが進んだ後でも、最新revisionを持つ要求/明示破棄なら本人の未有効化候補を取消せる。古いrevisionの入力要求自体は取消前に拒否する。

削除previewの呼出元である設定画面も、影響評価失敗時のerror.refを保持する。破棄して別の操作へ進む場合、そのrefだけを明示的に取消す。no-op/確認結果が確定した後のsnapshot DTO取得はbest-effortとし、表示用readの失敗で確定した結果/refを失わせない。

CommandがSuperseded等のterminalへ進んだ場合、またはScheduling/Applying以外で有効化済みと確認できた場合、保存済みcandidate/commandを照合してローカル確認cacheだけを解放する。別writerが異なるpolicyを保存しても、古いterminal cacheで次の編集を妨げない。まだ未有効化のPending/Failed/UncertainとScheduling/Applyingは保持する。初回設定のpolicy有効化後にprivate完了保存が失敗しても、後の完了復旧が成功した時点で同じbindingのonboarding cacheだけを解放する。

初回設定の安定rule/command ID、`submitted`の永続化、policy commit後のprivate完了復旧は従来通り。regular editorのcancelから初回設定の受理済み候補を取消さない。

## 画面と検証

利用場面は「既存の時間帯を確認し、編集しなかった/元に戻したまま内容を確認する」。nativeのno-op応答で編集画面に「変更はありません」「保存済みのルールと同じ内容です。一時解除の期限は変更していません。」を表示し、保存したルールへ戻れる。確認画面を開かず、保存/OS反映成功の表示を作らない。入力変更後はこの表示を消す。失敗時は入力を保持し、古いreviewから保存できない。

nativeのpreview待機中は対象・有効Switch・曜日・時間の全入力を無効にする。no-op応答でdirtyを解消する間に、新しい入力を古いsubmitted draftで上書きしない。

DESIGN原則1/3/5（本人の条件、正確な状態、操作を終えて離れる）、U04/U05、UI07/UI11/UI12/UI14/UI17/UI21/UI25を対象にする。既存Notice/Buttonと意味トークンを使い、追加の判断情報と戻る操作を縦の流れで示す。色だけで状態を伝えない。

Swiftは実SQLiteとfake scheduler/restriction/contextで、未変更、曜日順/重複の正規化、同一対象の再選択、変更→元に戻す、同件数の別対象、各実変更/削除/新規、stale revision/不正ID/不正入力、別フロー候補、取消済みref、再認可を検証する。grantの保存値・再open、識別子/影響評価portの呼出し回数、予定/適用回数も確認する。componentではnative no-opの表示、編集画面の再mount後のref保持、古いreviewの無効化、失敗時の入力保持、settingsの所有ref付き取消を確認する。

iOS署名無しビルドはrootの統合検証で実施する。Simulator、実機Screen Time、File Protection、VoiceOver/Dynamic Typeの成立はこのLinux/fake検証に含めない。実機のgrant継続は #131 の別ゲート。
