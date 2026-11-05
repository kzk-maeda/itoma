import { useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  APPS,
  DAYS,
  MINUTE,
  MODES,
  grantEnd,
  initialState,
  liveGrant,
  minuteLabel,
  nextBoundary,
  overlap,
  reconcileGrants,
  reducer,
  timeLabel,
  winner,
} from "./model";
import type { App, DemoState, Mode, Outcome, Rule } from "./model";
import s from "./design-demo.module.css";

function Button({
  children,
  onClick,
  disabled,
  secondary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={secondary ? s.secondary : s.button}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={s.dialogHeader}>
        <h2 id="dialog-title">{title}</h2>
        <button className={s.close} onClick={onClose} aria-label="画面を閉じる">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return <div className={s.notice}>{children}</div>;
}
function RuleEditor({
  state,
  original,
  onSave,
  onClose,
}: {
  state: DemoState;
  original?: Rule;
  onSave: (rules: Rule[]) => void;
  onClose: () => void;
}) {
  const [baseRevision] = useState(state.revision);
  const [draft, setDraft] = useState<Rule>(() =>
    original
      ? { ...original, apps: [...original.apps], days: [...original.days] }
      : {
          id: `rule-${state.sequence + 1}`,
          version: 1,
          name: "自分のルール",
          apps: ["YouTube"],
          days: [0, 1, 2, 3, 4],
          start: 720,
          end: 780,
          mode: "reason",
          enabled: true,
        },
  );
  const [priority, setPriority] = useState(
    original
      ? state.rules.findIndex((r) => r.id === original.id)
      : state.rules.length,
  );
  const [review, setReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty =
    !original ||
    JSON.stringify(draft) !== JSON.stringify(original) ||
    priority !== state.rules.findIndex((r) => r.id === original.id);
  const close = () => (dirty ? setDiscard(true) : onClose());
  const changed =
    original && JSON.stringify(draft) !== JSON.stringify(original);
  const rest = state.rules.filter((r) => r.id !== draft.id);
  const rules = [
    ...rest.slice(0, priority),
    { ...draft, version: changed ? draft.version + 1 : draft.version },
    ...rest.slice(priority),
  ];
  const overlaps = rules.filter((r) => r.id !== draft.id && overlap(draft, r));
  const reconciled = reconcileGrants({ ...state, rules });
  const affected = state.grants.filter(
    (g) =>
      ["active", "uncertain", "pending"].includes(g.status) &&
      reconciled.grants.some(
        (n) =>
          n.id === g.id && (n.status !== g.status || n.expiresAt < g.expiresAt),
      ),
  );
  const valid = draft.name.trim() && draft.apps.length && draft.days.length;
  const patch = (next: Partial<Rule>) => setDraft((d) => ({ ...d, ...next }));
  return (
    <Dialog
      title={
        review
          ? "優先順と解除への影響"
          : original
            ? "ルールを編集"
            : "ルールを追加"
      }
      onClose={close}
    >
      {discard ? (
        <section className={s.stack}>
          <h3>未反映の変更を破棄しますか？</h3>
          <p>確定したルールは変わりません。</p>
          <Button onClick={onClose}>変更を破棄して閉じる</Button>
          <Button secondary onClick={() => setDiscard(false)}>
            編集を続ける
          </Button>
        </section>
      ) : review ? (
        <div className={s.stack}>
          <p>
            上にあるルールが優先されます。同じアプリ・時間帯に有効なものから選びます。
          </p>
          <ol className={s.order}>
            {rules.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                <span>
                  {MODES[r.mode]}
                  {!r.enabled ? "・停止中" : ""}
                </span>
              </li>
            ))}
          </ol>
          <Notice>
            {overlaps.length
              ? `「${overlaps.map((r) => r.name).join("」「")}」との重複があります。モードの厳しさで自動決定しません。`
              : "共通するアプリ・時間帯の重複はありません。"}
          </Notice>
          {affected.map((g) => {
            const next = reconciled.grants.find((n) => n.id === g.id)!;
            return (
              <Notice key={g.id}>
                <strong>
                  {g.app} の解除が
                  {next.status === "invalidated" ? "終了" : "短縮"}します
                </strong>
                <p>
                  {timeLabel(g.expiresAt)}まで →{" "}
                  {next.status === "invalidated"
                    ? "反映時に終了"
                    : `${timeLabel(next.expiresAt)}まで`}
                </p>
                未来の優先切替も含めた確認です（P2対応仮説）。
              </Notice>
            );
          })}
          {baseRevision !== state.revision && (
            <p role="alert">
              設定が更新されました。閉じて最新の設定から編集し直してください。
            </p>
          )}
          <Button
            disabled={
              baseRevision !== state.revision ||
              state.operation?.status === "pending"
            }
            onClick={() => {
              onSave(rules);
              onClose();
            }}
          >
            優先順と影響を確認して反映
          </Button>
          <Button secondary onClick={() => setReview(false)}>
            編集に戻る
          </Button>
          <Button secondary onClick={close}>
            変更をキャンセル
          </Button>
        </div>
      ) : (
        <form
          className={s.stack}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setReview(true);
          }}
        >
          <label>
            ルール名
            <input
              autoFocus
              value={draft.name}
              maxLength={40}
              onChange={(e) => patch({ name: e.target.value })}
              required
            />
          </label>
          <fieldset>
            <legend>対象アプリ</legend>
            <div className={s.choices}>
              {APPS.map((app) => (
                <label key={app} className={s.choice}>
                  <input
                    type="checkbox"
                    checked={draft.apps.includes(app)}
                    onChange={() =>
                      patch({
                        apps: draft.apps.includes(app)
                          ? draft.apps.filter((a) => a !== app)
                          : [...draft.apps, app],
                      })
                    }
                  />
                  {app}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>開始する曜日</legend>
            <div className={s.choices}>
              {DAYS.map((day, i) => (
                <label key={day} className={s.choice}>
                  <input
                    type="checkbox"
                    checked={draft.days.includes(i)}
                    onChange={() =>
                      patch({
                        days: draft.days.includes(i)
                          ? draft.days.filter((d) => d !== i)
                          : [...draft.days, i],
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={s.timeInputs}>
            <label>
              開始
              <input
                type="time"
                value={minuteLabel(draft.start)}
                required
                onChange={(e) => {
                  if (e.target.value) {
                    const [h, m] = e.target.value.split(":").map(Number);
                    patch({ start: h * 60 + m });
                  }
                }}
              />
            </label>
            <label>
              終了
              <input
                type="time"
                value={minuteLabel(draft.end)}
                required
                onChange={(e) => {
                  if (e.target.value) {
                    const [h, m] = e.target.value.split(":").map(Number);
                    patch({ end: h * 60 + m });
                  }
                }}
              />
            </label>
          </div>
          <p className={s.muted}>
            終了が開始以前なら翌日まで。同時刻は24時間の例として扱います。日跨ぎは開始日の曜日です。
          </p>
          <label>
            解除条件
            <select
              value={draft.mode}
              onChange={(e) => patch({ mode: e.target.value as Mode })}
            >
              {Object.entries(MODES).map(([mode, name]) => (
                <option key={mode} value={mode}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            優先順位
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            >
              {Array.from({ length: rest.length + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}番目
                  {!i ? "（最優先）" : i === rest.length ? "（最後）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={s.choice}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            このルールを有効にする
          </label>
          {!valid && (
            <p role="alert">名前・対象アプリ・曜日を選んでください。</p>
          )}
          <Button type="submit" disabled={!valid}>
            次へ 優先と影響を確認
          </Button>
          <Button secondary onClick={close}>
            変更をキャンセル
          </Button>
        </form>
      )}
    </Dialog>
  );
}
function Unlock({
  state,
  app,
  dispatch,
  onClose,
}: {
  state: DemoState;
  app: App;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  onClose: () => void;
}) {
  const w = winner(state.rules, app, state.now);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [duration, setDuration] = useState(5);
  const [discard, setDiscard] = useState(false);
  const close = () => (reason || amount ? setDiscard(true) : onClose());
  const end = grantEnd(state, app, duration);
  const mode = w?.rule.mode;
  const ready =
    w &&
    mode !== "locked" &&
    state.auth === "approved" &&
    state.activation === "enabled" &&
    !liveGrant(state, app) &&
    state.operation?.status !== "pending";
  const valid =
    ready && (mode === "reason" ? !!reason.trim() : amount !== null);
  return (
    <Dialog title={`${app} を一時解除`} onClose={close}>
      {discard ? (
        <div className={s.stack}>
          <h3>入力を破棄しますか？</h3>
          <p>解除は付与されません。理由本文は保存されません。</p>
          <Button onClick={onClose}>入力を破棄して閉じる</Button>
          <Button secondary onClick={() => setDiscard(false)}>
            入力を続ける
          </Button>
        </div>
      ) : (
        <form
          className={s.stack}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) {
              dispatch({ type: "request", app, duration, reason, amount });
              onClose();
            }
          }}
        >
          <p>
            優先ルール：<strong>{w?.rule.name ?? "現在は対象外"}</strong>
          </p>
          <Notice>
            実際のアプリ制限・請求はありません。理由にはサンプルを使ってください。
          </Notice>
          {mode === "reason" && (
            <>
              <label>
                使う理由
                <textarea
                  autoFocus
                  value={reason}
                  maxLength={500}
                  placeholder="例：調べ物の動画を確認する"
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
              <Button
                secondary
                onClick={() => setReason("調べ物の動画を確認する")}
              >
                サンプル理由を入力
              </Button>
            </>
          )}
          {mode === "dummy" && (
            <fieldset>
              <legend>模擬の金額を選択 実際の請求はありません</legend>
              <div className={s.choices}>
                {[100, 300, 500].map((value) => (
                  <label key={value} className={s.choice}>
                    <input
                      type="radio"
                      name="amount"
                      checked={amount === value}
                      onChange={() => setAmount(value)}
                    />
                    {value}円
                  </label>
                ))}
              </div>
              <p className={s.muted}>
                金額は体験用の仮値で、採用済み価格ではありません。
              </p>
            </fieldset>
          )}
          <label>
            解除時間
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {[1, 5, 10, 15, 30].map((n) => (
                <option key={n} value={n}>
                  {n}分
                </option>
              ))}
            </select>
          </label>
          <div className={s.deadline}>
            <span>終了予定</span>
            <strong>{timeLabel(end)}</strong>
            <span>
              最大 {Math.max(0, (end - state.now) / MINUTE)}{" "}
              分。優先切替・期間終了までが上限です。
            </span>
          </div>
          {!ready && (
            <p role="alert">
              ルール・認可・処理状態が変わりました。閉じて現在の状態を確認してください。
            </p>
          )}
          <Button type="submit" disabled={!valid}>
            条件と終了時刻を確認して解除
          </Button>
          <Button secondary onClick={close}>
            解除をキャンセル
          </Button>
        </form>
      )}
    </Dialog>
  );
}
export function DesignDemo() {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initialState(),
  );
  const [modal, setModal] = useState<
    | { kind: "rule"; id?: string }
    | { kind: "unlock"; app: App }
    | { kind: "permission" }
    | { kind: "reset" }
    | { kind: "delete" }
    | null
  >(null);
  const pending = state.operation?.status === "pending";
  const opId = state.operation?.id;
  const returnFocus = useRef<HTMLElement | null>(null);
  const show = (next: NonNullable<typeof modal>) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setModal(next);
  };
  const close = () => {
    setModal(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  };
  useEffect(() => {
    if (!pending || opId === undefined) return;
    const timer = setTimeout(() => dispatch({ type: "finish", id: opId }), 800);
    return () => clearTimeout(timer);
  }, [pending, opId]);
  const activateScenario = (
    kind:
      | "basic"
      | "conflict"
      | "night"
      | "failed"
      | "schedule-failed"
      | "reauth",
  ) => {
    dispatch({ type: "reset", authorized: true });
    if (kind === "night") dispatch({ type: "advance", minutes: 600 });
    if (kind === "failed") dispatch({ type: "outcome", value: "failed" });
    if (kind === "schedule-failed")
      dispatch({ type: "outcome", value: "schedule-failed" });
    if (kind === "reauth") dispatch({ type: "authorization", value: "denied" });
    if (kind === "conflict") {
      const rules = initialState(true).rules;
      const focus = { ...rules[1], enabled: true };
      dispatch({
        type: "save",
        rules: [focus, rules[0], rules[2]],
        expectedRevision: 1,
      });
    }
  };
  const status = pending
    ? "模擬反映中"
    : state.observation === "applied"
      ? "模擬反映を確認"
      : state.observation === "failed"
        ? "模擬反映に失敗"
        : "反映結果は未確認";
  const next = Math.min(
    ...APPS.map((app) => nextBoundary(state.rules, app, state.now)),
  );
  return (
    <main className={s.page}>
      <header className={s.header}>
        <a className={s.brand} href="#main">
          <span className={s.mark}>い</span>
          <span>
            いとま <small>ITOMA</small>
          </span>
        </a>
        <span className={s.pill}>PR 36 · 体験デモ</span>
      </header>
      <div className={s.intro}>
        <div>
          <p className={s.eyebrow}>自分で決める、スマホとの距離。</p>
          <h1>
            ルールを決めて、
            <br />
            自分の時間へ。
          </h1>
          <p>
            選ぶ。確かめる。必要なときだけ、ひと呼吸。
            <br />
            設計案のフローを、その場で試せます。
          </p>
          <a href="#scenarios">シナリオから体験する ↓</a>
        </div>
        <aside className={s.demoNote}>
          <strong>Web上のシミュレーションです</strong>
          <p>
            実際のOS制限・認可・課金・SQLite保存は行いません。状態と入力はページ内のメモリだけに保持し、再読込で初期化されます。
          </p>
          <a
            href="https://github.com/kzk-maeda/itoma/pull/36"
            target="_blank"
            rel="noreferrer"
          >
            設計PRを見る ↗
          </a>
        </aside>
      </div>
      <div className={s.layout} id="main">
        <div className={s.mainColumn}>
          <section className={s.statusCard} aria-labelledby="status-heading">
            <div className={s.sectionTop}>
              <h2 id="status-heading">いまの設定</h2>
              <span className={s.pill}>
                {state.activation === "enabled"
                  ? "利用中"
                  : state.activation === "paused"
                    ? "本人が停止中"
                    : "再開の確認待ち"}
              </span>
            </div>
            <div className={s.clock}>
              <span>デモ時刻</span>
              <strong>{timeLabel(state.now)}</strong>
              <span>2026年11月の模擬カレンダー</span>
            </div>
            <div className={s.row}>
              <Button
                secondary
                disabled={pending}
                onClick={() => dispatch({ type: "advance", minutes: 1 })}
              >
                1分進める
              </Button>
              <Button
                secondary
                disabled={pending}
                onClick={() => dispatch({ type: "advance", minutes: 5 })}
              >
                5分進める
              </Button>
            </div>
            <div className={s.statusLine} role="status" aria-live="polite">
              <span
                className={
                  state.observation === "applied" && !pending
                    ? s.dot
                    : s.dotMuted
                }
              />
              <strong>{status}</strong>
            </div>
            <p className={s.muted}>
              確定設定 v{state.revision} · 最終確認{" "}
              {state.observedAt ? timeLabel(state.observedAt) : "なし"} ·
              次の切替 {Number.isFinite(next) ? timeLabel(next) : "なし"}
            </p>
            {state.auth !== "approved" ? (
              <Notice>
                <strong>
                  認可が{state.auth === "unknown" ? "未確認" : "拒否・取消"}
                  の想定です
                </strong>
                <p>
                  ルールは保持されます。模擬認可を許可してから、本人の操作で開始してください。
                </p>
                <Button onClick={() => show({ kind: "permission" })}>
                  認可を体験する
                </Button>
              </Notice>
            ) : state.activation !== "enabled" ? (
              <Notice>
                <p>
                  認可の許可だけでは再開しません。保存済みルールを確認して開始できます。
                </p>
                <Button
                  disabled={pending}
                  onClick={() => dispatch({ type: "resume" })}
                >
                  確認して制限を開始する
                </Button>
              </Notice>
            ) : (
              <div className={s.row}>
                <Button secondary onClick={() => dispatch({ type: "stop" })}>
                  全体を停止する
                </Button>
                <Button
                  secondary
                  disabled={pending}
                  onClick={() =>
                    dispatch({ type: "authorization", value: "denied" })
                  }
                >
                  認可取消を試す
                </Button>
              </div>
            )}
            {state.operation &&
              ["failed", "unknown"].includes(state.operation.status) && (
                <Notice>
                  <p>
                    確定設定は保持しています。再試行でも元の解除期限を延ばしません。
                  </p>
                  <Button onClick={() => dispatch({ type: "retry" })}>
                    同じ操作を再試行する
                  </Button>
                </Notice>
              )}
          </section>
          <section className={s.section} aria-labelledby="apps-heading">
            <div className={s.sectionTop}>
              <h2 id="apps-heading">対象アプリ</h2>
              <span className={s.muted}>いま有効な優先ルール</span>
            </div>
            <div className={s.apps}>
              {APPS.map((app, index) => {
                const w = winner(state.rules, app, state.now);
                const g = liveGrant(state, app);
                const active = g?.status === "active";
                const enabled =
                  state.auth === "approved" && state.activation === "enabled";
                return (
                  <article className={s.appCard} key={app}>
                    <div className={s.appIdentity}>
                      <span className={s.appIcon}>
                        {["▶", "X", "◎"][index]}
                      </span>
                      <div>
                        <h3>{app}</h3>
                        <p>
                          {w
                            ? `${w.rule.name} · ${MODES[w.rule.mode]}`
                            : "現在の時間帯はルール対象外"}
                        </p>
                      </div>
                    </div>
                    <strong className={s.appState}>
                      {!enabled
                        ? "制限の開始待ち"
                        : g?.status === "uncertain"
                          ? "解除結果は不明"
                          : active
                            ? `一時解除中 · 残り${Math.ceil((g.expiresAt - state.now) / MINUTE)}分`
                            : g?.status === "pending"
                              ? "解除を処理中"
                              : w
                                ? "設定上は制限対象"
                                : "設定上は制限なし"}
                    </strong>
                    {g && (
                      <p className={s.muted}>
                        解除期限 {timeLabel(g.expiresAt)} ·
                        再表示しても延長しません
                      </p>
                    )}
                    {w?.rule.mode === "locked" && (
                      <p className={s.muted}>
                        この時間は一時解除不可。本体のルール編集・停止は可能です。
                      </p>
                    )}
                    <Button
                      secondary
                      disabled={
                        !enabled ||
                        !w ||
                        w.rule.mode === "locked" ||
                        !!g ||
                        pending
                      }
                      onClick={() => show({ kind: "unlock", app })}
                    >
                      {active ? "期限まで一時解除中" : "一時解除を試す"}
                    </Button>
                  </article>
                );
              })}
            </div>
          </section>
          <section className={s.section} aria-labelledby="rules-heading">
            <div className={s.sectionTop}>
              <div>
                <p className={s.eyebrow}>自分で選ぶ優先順</p>
                <h2 id="rules-heading">時間帯のルール</h2>
              </div>
              <Button
                secondary
                disabled={pending}
                onClick={() => show({ kind: "rule" })}
              >
                ルールを追加
              </Button>
            </div>
            <p className={s.muted}>
              上が優先。同じアプリ・時間帯が重なるときは、保存前に順序と解除への影響を確認します。
            </p>
            <ol className={s.rules}>
              {state.rules.map((r, i) => (
                <li key={r.id} className={!r.enabled ? s.pausedRule : ""}>
                  <span className={s.ruleNumber}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className={s.ruleCopy}>
                    <h3>
                      {r.name} {!r.enabled && <small>停止中</small>}
                    </h3>
                    <p>
                      {r.days.map((d) => DAYS[d]).join("・")}{" "}
                      {minuteLabel(r.start)}—{r.end <= r.start ? "翌" : ""}
                      {minuteLabel(r.end)}
                    </p>
                    <p>
                      {r.apps.join("・")} · {MODES[r.mode]}
                    </p>
                  </div>
                  <Button
                    secondary
                    disabled={pending}
                    onClick={() => show({ kind: "rule", id: r.id })}
                  >
                    編集
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className={s.sidebar}>
          <section className={s.guide}>
            <p className={s.eyebrow}>はじめての体験</p>
            <h2>
              3つの操作で、
              <br />
              設計を確かめる。
            </h2>
            <ol>
              <li>
                <strong>ルールを編集</strong>
                <p>曜日・対象・条件を選び、優先順を確認。</p>
              </li>
              <li>
                <strong>一時解除を試す</strong>
                <p>理由または模擬金額と、終了時刻を確認。</p>
              </li>
              <li>
                <strong>時刻を進める</strong>
                <p>期限切れや優先切替で、解除が終わる。</p>
              </li>
            </ol>
          </section>
          <section className={s.panel} id="scenarios">
            <h2>シナリオから試す</h2>
            <p className={s.muted}>
              選ぶと入力・設定・履歴を初期化します。すべて模擬認可済みの例から始めます。
            </p>
            <div className={s.scenarios}>
              <Button secondary onClick={() => activateScenario("basic")}>
                01 理由入力で5分解除
              </Button>
              <Button secondary onClick={() => activateScenario("conflict")}>
                02 2分後に優先ルール切替
              </Button>
              <Button secondary onClick={() => activateScenario("night")}>
                03 夜のダミー課金
              </Button>
              <Button secondary onClick={() => activateScenario("failed")}>
                04 適用失敗と再試行
              </Button>
              <Button
                secondary
                onClick={() => activateScenario("schedule-failed")}
              >
                05 期限イベント登録失敗
              </Button>
              <Button secondary onClick={() => activateScenario("reauth")}>
                06 認可取消と本人の再開
              </Button>
            </div>
          </section>
          <section className={s.panel}>
            <h2>反映結果を切り替える</h2>
            <p className={s.muted}>
              次に受理される操作の模擬結果です。失敗後は「成功」に戻して再試行できます。
            </p>
            <label>
              次の模擬結果
              <select
                disabled={pending}
                value={state.outcome}
                onChange={(e) =>
                  dispatch({
                    type: "outcome",
                    value: e.target.value as Outcome,
                  })
                }
              >
                <option value="success">成功</option>
                <option value="failed">適用失敗</option>
                <option value="unknown">結果保存前に中断</option>
                <option value="schedule-failed">期限登録失敗の想定</option>
              </select>
            </label>
            <p className={s.muted}>
              P1対応仮説：期限登録に失敗した想定では新しい解除を行いません。実APIの順序・復旧は未検証です。
            </p>
          </section>
        </aside>
      </div>
      <section className={s.history}>
        <div className={s.sectionTop}>
          <div>
            <p className={s.eyebrow}>処理の流れを振り返る</p>
            <h2>この体験の操作記録</h2>
          </div>
          <Button secondary onClick={() => show({ kind: "delete" })}>
            理由・記録を削除
          </Button>
        </div>
        <p className={s.muted}>
          最新30件まで。理由本文はこの一覧に出しません。本文のメモリ保持{" "}
          {state.reasons.length}件。外部送信はしません。
        </p>
        <ol className={s.events} aria-live="polite">
          {state.events.length ? (
            state.events.map((e) => (
              <li key={e.id}>
                <time>{timeLabel(e.time)}</time>
                <span>{e.text}</span>
              </li>
            ))
          ) : (
            <li>
              まだ操作はありません。認可またはシナリオから始めてください。
            </li>
          )}
        </ol>
      </section>
      <details className={s.details}>
        <summary>設計との対応とデモの範囲</summary>
        <div className={s.detailsBody}>
          <p>
            希望設定・認可・本人の再開承認・操作受付・期限付き解除・観測を別々に扱います。このWebモデルは採用前のPR
            #36を説明する専用モックで、本体Swiftの評価ロジックではありません。
          </p>
          <p>
            P1の期限登録失敗時の解除中止、P2の未来の切替による期限短縮はレビュー対応の体験用仮説です。PRの採用済み仕様・OS動作の証明にはしません。
          </p>
          <p>
            週間予定は模擬カレンダー上で評価します。DST・実タイムゾーン移動・端末時計変更・OS強制終了・本物の永続化・2DBの整合性・容量警告・ファイル保護は対象外です。時刻は手動で進め、実時間では自動進行しません。
          </p>
          <p>
            同時刻の開始・終了は、編集画面で明示した24時間の例として扱います。価格・プリセット名は仮値です。模擬履歴の閲覧は理解のための補助で、製品の初版必須機能を追加する判断ではありません。
          </p>
          <div className={s.row}>
            <a
              href="https://github.com/kzk-maeda/itoma/pull/36"
              target="_blank"
              rel="noreferrer"
            >
              PR 36 ↗
            </a>
            <a
              href="https://chatgpt.com/space/page_1d85ac49c540819193e465570f01b478"
              target="_blank"
              rel="noreferrer"
            >
              図解ドキュメント ↗
            </a>
          </div>
        </div>
      </details>
      <footer className={s.footer}>
        <span>空いた時間に、何をしよう。</span>
        <Button secondary onClick={() => show({ kind: "reset" })}>
          最初からやり直す
        </Button>
      </footer>
      {modal?.kind === "rule" && (
        <RuleEditor
          state={state}
          original={state.rules.find((r) => r.id === modal.id)}
          onSave={(rules) =>
            dispatch({ type: "save", rules, expectedRevision: state.revision })
          }
          onClose={close}
        />
      )}
      {modal?.kind === "unlock" && (
        <Unlock
          state={state}
          app={modal.app}
          dispatch={dispatch}
          onClose={close}
        />
      )}
      {modal?.kind === "permission" && (
        <Dialog title="模擬認可を体験" onClose={close}>
          <div className={s.stack}>
            <p>
              実際のiOS認可画面ではありません。許可・拒否したときの表示を体験します。
            </p>
            <Button
              onClick={() => {
                dispatch({ type: "authorization", value: "approved" });
                close();
              }}
            >
              模擬認可を許可する
            </Button>
            <Button
              secondary
              onClick={() => {
                dispatch({ type: "authorization", value: "denied" });
                close();
              }}
            >
              模擬認可を拒否する
            </Button>
            <Button secondary onClick={close}>
              キャンセル
            </Button>
          </div>
        </Dialog>
      )}
      {(modal?.kind === "reset" || modal?.kind === "delete") && (
        <Dialog
          title={
            modal.kind === "reset"
              ? "体験を初期化しますか？"
              : "理由・記録を削除しますか？"
          }
          onClose={close}
        >
          <div className={s.stack}>
            <p>
              {modal.kind === "reset"
                ? "このページ内の入力・設定・期限・操作記録を初期状態に戻します。"
                : "このページ内に保持している理由本文と操作記録を削除します。ルールと解除期限は変わりません。"}
            </p>
            <Button
              onClick={() => {
                dispatch(
                  modal.kind === "reset"
                    ? { type: "reset" }
                    : { type: "deleteHistory" },
                );
                close();
              }}
            >
              {modal.kind === "reset" ? "初期化する" : "削除する"}
            </Button>
            <Button secondary onClick={close}>
              キャンセル
            </Button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
