/** PR #36 review simulator only. Not the production Swift evaluator or OS adapter. */
export const APPS = ["YouTube", "X", "Instagram"] as const;
export type App = (typeof APPS)[number];
export type Mode = "reason" | "dummy" | "locked";
export type Outcome = "success" | "failed" | "unknown" | "schedule-failed";
export const MODES: Record<Mode, string> = {
  reason: "理由入力",
  dummy: "ダミー課金",
  locked: "一時解除不可",
};
export const DAYS = ["月", "火", "水", "木", "金", "土", "日"];
export const MINUTE = 60_000;
export const EPOCH = Date.UTC(2026, 10, 2); // Monday. Demo calendar, independent of device clock.
export type Rule = {
  id: string;
  version: number;
  name: string;
  apps: App[];
  days: number[];
  start: number;
  end: number;
  mode: Mode;
  enabled: boolean;
};
export type Grant = {
  id: number;
  app: App;
  ruleId: string;
  version: number;
  occurrence: number;
  acceptedAt: number;
  expiresAt: number;
  status:
    | "pending"
    | "active"
    | "uncertain"
    | "expired"
    | "invalidated"
    | "failed";
};
export type Operation = {
  id: number;
  kind: "policy" | "grant" | "resume" | "stop" | "reblock";
  status: "pending" | "success" | "failed" | "unknown";
  grantId?: number;
  outcome: Outcome;
};
export type DemoState = {
  now: number;
  rules: Rule[];
  revision: number;
  auth: "unknown" | "approved" | "denied";
  activation: "enabled" | "paused" | "awaiting";
  grants: Grant[];
  operation: Operation | null;
  observation: "applied" | "failed" | "unknown";
  observedAt: number | null;
  outcome: Outcome;
  sequence: number;
  events: { id: number; time: number; text: string }[];
  reasons: { commandId: number; text: string }[];
  historyGap: boolean;
};
export function initialState(authorized = false): DemoState {
  return {
    now: EPOCH + 720 * MINUTE,
    revision: 1,
    auth: authorized ? "approved" : "unknown",
    activation: authorized ? "enabled" : "awaiting",
    rules: [
      {
        id: "work",
        version: 1,
        name: "仕事の時間",
        apps: ["YouTube", "X"],
        days: [0, 1, 2, 3, 4],
        start: 540,
        end: 1080,
        mode: "reason",
        enabled: true,
      },
      {
        id: "focus",
        version: 1,
        name: "短い集中",
        apps: ["YouTube"],
        days: [0, 1, 2, 3, 4],
        start: 722,
        end: 750,
        mode: "locked",
        enabled: false,
      },
      {
        id: "night",
        version: 1,
        name: "夜の余白",
        apps: ["YouTube", "X"],
        days: [0, 1, 2, 3, 4],
        start: 1260,
        end: 120,
        mode: "dummy",
        enabled: true,
      },
    ],
    grants: [],
    operation: null,
    observation: authorized ? "applied" : "unknown",
    observedAt: authorized ? EPOCH + 720 * MINUTE : null,
    outcome: "success",
    sequence: 0,
    events: [],
    reasons: [],
    historyGap: false,
  };
}
export function occurrences(rule: Rule, now: number) {
  const day = Math.floor((now - EPOCH) / (1440 * MINUTE));
  return Array.from({ length: 10 }, (_, i) => day - 1 + i)
    .filter((d) => rule.days.includes(((d % 7) + 7) % 7))
    .map((d) => {
      const start = EPOCH + (d * 1440 + rule.start) * MINUTE;
      const end =
        EPOCH +
        (d * 1440 + rule.end + (rule.end <= rule.start ? 1440 : 0)) * MINUTE;
      return { start, end };
    });
}
export function winner(rules: Rule[], app: App, now: number) {
  for (const rule of rules) {
    if (!rule.enabled || !rule.apps.includes(app)) continue;
    const span = occurrences(rule, now).find(
      (x) => x.start <= now && now < x.end,
    );
    if (span) return { rule, ...span };
  }
  return null;
}
export function nextBoundary(rules: Rule[], app: App, now: number) {
  const current = winner(rules, app, now);
  const points = [
    ...new Set(
      rules
        .filter((r) => r.enabled && r.apps.includes(app))
        .flatMap((r) => occurrences(r, now).flatMap((x) => [x.start, x.end])),
    ),
  ]
    .filter((t) => t > now)
    .sort((a, b) => a - b);
  return (
    points.find((t) => {
      const next = winner(rules, app, t);
      return (
        next?.rule.id !== current?.rule.id ||
        next?.rule.version !== current?.rule.version ||
        next?.start !== current?.start
      );
    }) ?? Infinity
  );
}
export function grantEnd(state: DemoState, app: App, duration: number) {
  const current = winner(state.rules, app, state.now);
  return current
    ? Math.min(
        state.now + duration * MINUTE,
        current.end,
        nextBoundary(state.rules, app, state.now),
      )
    : state.now;
}
export function liveGrant(state: DemoState, app: App) {
  return state.grants.find(
    (g) =>
      g.app === app &&
      ["pending", "active", "uncertain"].includes(g.status) &&
      g.expiresAt > state.now,
  );
}
export function overlap(a: Rule, b: Rule) {
  if (!a.enabled || !b.enabled || !a.apps.some((x) => b.apps.includes(x)))
    return false;
  const first = occurrences(a, EPOCH),
    second = occurrences(b, EPOCH);
  return first.some((x) =>
    second.some((y) => Math.max(x.start, y.start) < Math.min(x.end, y.end)),
  );
}
export function reconcileGrants(state: DemoState): DemoState {
  return {
    ...state,
    grants: state.grants.map((g) => {
      if (!["pending", "active", "uncertain"].includes(g.status)) return g;
      if (state.now >= g.expiresAt) return { ...g, status: "expired" };
      const w = winner(state.rules, g.app, state.now);
      if (
        state.auth !== "approved" ||
        state.activation !== "enabled" ||
        w?.rule.id !== g.ruleId ||
        w.rule.version !== g.version ||
        w.start !== g.occurrence
      )
        return { ...g, status: "invalidated" };
      // P2 review hypothesis: a newly earlier future boundary may shorten, never extend.
      return {
        ...g,
        expiresAt: Math.min(
          g.expiresAt,
          nextBoundary(state.rules, g.app, state.now),
        ),
      };
    }),
  };
}
function record(state: DemoState, text: string): DemoState {
  const id = state.sequence + 1;
  return {
    ...state,
    sequence: id,
    events: [{ id, time: state.now, text }, ...state.events].slice(0, 30),
  };
}
function startOperation(
  state: DemoState,
  kind: Operation["kind"],
  grantId?: number,
): DemoState {
  const id = state.sequence + 1;
  return record(
    {
      ...state,
      observation: "unknown",
      operation: {
        id,
        kind,
        grantId,
        status: "pending",
        outcome: state.outcome,
      },
    },
    `${kind === "grant" ? "解除要求" : kind === "policy" ? "設定変更" : kind === "stop" ? "停止" : kind === "reblock" ? "境界の再評価" : "再開"}を受理。反映結果はまだ未確認`,
  );
}
export type Action =
  | { type: "reset"; authorized?: boolean }
  | { type: "outcome"; value: Outcome }
  | { type: "authorization"; value: "approved" | "denied" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "save"; rules: Rule[]; expectedRevision: number }
  | {
      type: "request";
      app: App;
      duration: number;
      reason: string;
      amount: number | null;
    }
  | { type: "finish"; id: number }
  | { type: "retry" }
  | { type: "advance"; minutes: number }
  | { type: "deleteHistory" };
export function reducer(state: DemoState, action: Action): DemoState {
  if (action.type === "reset")
    return { ...initialState(action.authorized), sequence: state.sequence + 1 };
  if (action.type === "outcome") return { ...state, outcome: action.value };
  if (action.type === "authorization") {
    if (action.value === "approved")
      return record(
        { ...state, auth: "approved" },
        "模擬認可を許可。本人が再開するまでは適用しません",
      );
    return record(
      reconcileGrants({
        ...state,
        auth: "denied",
        activation: "awaiting",
        observation: "unknown",
        operation: null,
      }),
      "模擬認可を拒否・取消。設定を保持し、解除を無効化",
    );
  }
  if (action.type === "deleteHistory")
    return record(
      { ...state, reasons: [], events: [], historyGap: false },
      "理由・操作記録を削除。ルールと期限は維持",
    );
  if (action.type === "advance") {
    const now = state.now + action.minutes * MINUTE;
    const next = reconcileGrants({ ...state, now });
    const crossed =
      APPS.some((app) => nextBoundary(state.rules, app, state.now) <= now) ||
      state.grants.some(
        (g) =>
          ["active", "pending", "uncertain"].includes(g.status) &&
          g.expiresAt <= now,
      );
    return crossed &&
      state.auth === "approved" &&
      state.activation === "enabled"
      ? startOperation(next, "reblock")
      : next;
  }
  if (action.type === "finish") {
    const op = state.operation;
    if (!op || op.id !== action.id || op.status !== "pending") return state;
    const authorized = state.auth === "approved";
    const success = op.outcome === "success" && authorized;
    const uncertain = op.outcome === "unknown" && authorized;
    const status = success ? "success" : uncertain ? "unknown" : "failed";
    const next: DemoState = {
      ...state,
      observation: success ? "applied" : uncertain ? "unknown" : "failed",
      observedAt: success ? state.now : state.observedAt,
      operation: { ...op, status },
      grants: state.grants.map((g) =>
        g.id === op.grantId &&
        ["pending", "uncertain", "failed"].includes(g.status)
          ? {
              ...g,
              status: success ? "active" : uncertain ? "uncertain" : "failed",
            }
          : g,
      ),
    };
    return record(
      reconcileGrants(next),
      success
        ? "自分の設定の模擬反映を確認（実際のOS制限ではありません）"
        : op.outcome === "schedule-failed" && op.kind === "grant"
          ? "期限登録に失敗した想定。解除せず、同じ期限で再試行へ（P1対応仮説）"
          : uncertain
            ? "結果保存前に中断した想定。解除・制限の結果は不明"
            : "模擬反映に失敗。確定設定を保持し、本人の再試行を待機",
    );
  }
  if (action.type === "stop")
    return startOperation(
      reconcileGrants({ ...state, activation: "paused" }),
      "stop",
    );
  if (state.operation?.status === "pending") return state;
  if (action.type === "resume") {
    if (state.auth !== "approved") return state;
    return startOperation({ ...state, activation: "enabled" }, "resume");
  }
  if (action.type === "save") {
    if (action.expectedRevision !== state.revision)
      return record(state, "設定版が競合。最新設定を確認してください");
    const next = reconcileGrants({
      ...state,
      rules: action.rules,
      revision: state.revision + 1,
    });
    return startOperation(next, "policy");
  }
  if (action.type === "request") {
    const w = winner(state.rules, action.app, state.now);
    if (
      state.auth !== "approved" ||
      state.activation !== "enabled" ||
      !w ||
      w.rule.mode === "locked" ||
      liveGrant(state, action.app) ||
      !Number.isInteger(action.duration) ||
      action.duration < 1 ||
      action.duration > 30 ||
      (w.rule.mode === "reason" && !action.reason.trim()) ||
      (w.rule.mode === "dummy" && ![100, 300, 500].includes(action.amount ?? 0))
    )
      return state;
    const id = state.sequence + 1;
    const grant: Grant = {
      id,
      app: action.app,
      ruleId: w.rule.id,
      version: w.rule.version,
      occurrence: w.start,
      acceptedAt: state.now,
      expiresAt: grantEnd(state, action.app, action.duration),
      status: "pending",
    };
    return startOperation(
      {
        ...state,
        grants: [...state.grants, grant].slice(-30),
        reasons:
          w.rule.mode === "reason"
            ? [
                ...state.reasons,
                { commandId: id, text: action.reason.trim() },
              ].slice(-30)
            : state.reasons,
      },
      "grant",
      id,
    );
  }
  if (action.type === "retry") {
    const op = state.operation;
    if (!op || !["failed", "unknown"].includes(op.status)) return state;
    const grant = state.grants.find((g) => g.id === op.grantId);
    if (op.kind === "grant") {
      const w = grant && winner(state.rules, grant.app, state.now);
      if (
        !grant ||
        grant.expiresAt <= state.now ||
        state.auth !== "approved" ||
        state.activation !== "enabled" ||
        w?.rule.id !== grant.ruleId ||
        w.rule.version !== grant.version ||
        w.start !== grant.occurrence ||
        ["invalidated", "expired"].includes(grant.status)
      )
        return record(
          state,
          "再試行不可。期限またはルールが変わったため新しい本人確認が必要",
        );
    }
    return startOperation(
      {
        ...state,
        grants: state.grants.map((g) =>
          g.id === op.grantId ? { ...g, status: "pending" } : g,
        ),
      },
      op.kind,
      op.grantId,
    );
  }
  return state;
}
export function timeLabel(now: number) {
  const d = new Date(now);
  return `${DAYS[(d.getUTCDay() + 6) % 7]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function minuteLabel(n: number) {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
