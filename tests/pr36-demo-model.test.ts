import {
  EPOCH,
  MINUTE,
  grantEnd,
  initialState,
  liveGrant,
  nextBoundary,
  overlap,
  reconcileGrants,
  reducer,
  winner,
} from "../src/demo/pr36/model";
import type { DemoState } from "../src/demo/pr36/model";

const finish = (s: DemoState) =>
  reducer(s, { type: "finish", id: s.operation!.id });
const request = (s = initialState(true)) =>
  reducer(s, {
    type: "request",
    app: "YouTube",
    duration: 5,
    reason: "サンプル",
    amount: null,
  });

test("day-crossing belongs to the starting weekday and has an exclusive end", () => {
  const rules = initialState(true).rules;
  expect(winner(rules, "X", EPOCH + (5 * 1440 + 60) * MINUTE)?.rule.id).toBe(
    "night",
  ); // Saturday 01:00, Friday occurrence
  expect(winner(rules, "X", EPOCH + (5 * 1440 + 120) * MINUTE)).toBeNull();
  expect(winner(rules, "X", EPOCH + (7 * 1440 + 60) * MINUTE)).toBeNull(); // Monday 01:00, Sunday start excluded
});
test("priority and next boundary cap a grant at the upcoming winner change", () => {
  const s = initialState(true);
  const focus = { ...s.rules[1], enabled: true };
  const rules = [focus, s.rules[0], s.rules[2]];
  expect(overlap(focus, s.rules[0])).toBe(true);
  expect(grantEnd({ ...s, rules }, "YouTube", 5)).toBe(s.now + 2 * MINUTE);
  expect(nextBoundary(rules, "YouTube", s.now)).toBe(s.now + 2 * MINUTE);
  expect(winner(rules, "YouTube", s.now + 2 * MINUTE)?.rule.mode).toBe(
    "locked",
  );
});
test("same-target duplicate requests cannot extend or duplicate a grant", () => {
  let s = request();
  const first = s.grants[0];
  s = request(s);
  expect(s.grants).toHaveLength(1);
  s = finish(s);
  s = request(s);
  expect(s.grants).toHaveLength(1);
  expect(s.grants[0].expiresAt).toBe(first.expiresAt);
});
test("invalid conditions never create a grant", () => {
  for (const reason of ["", "  \n "])
    expect(
      reducer(initialState(true), {
        type: "request",
        app: "YouTube",
        duration: 5,
        reason,
        amount: null,
      }).grants,
    ).toHaveLength(0);
  expect(request(initialState()).grants).toHaveLength(0);
  expect(
    reducer(initialState(true), {
      type: "request",
      app: "X",
      duration: 31,
      reason: "a",
      amount: null,
    }).grants,
  ).toHaveLength(0);
});
test("unknown results reserve the same grant and retry preserves its absolute deadline", () => {
  let s = reducer(initialState(true), { type: "outcome", value: "unknown" });
  s = finish(request(s));
  const expiry = s.grants[0].expiresAt;
  expect(s.grants[0].status).toBe("uncertain");
  expect(request(s).grants).toHaveLength(1);
  s = reducer(s, { type: "advance", minutes: 1 });
  s = reducer(s, { type: "outcome", value: "success" });
  s = finish(reducer(s, { type: "retry" }));
  expect(s.grants[0].expiresAt).toBe(expiry);
  expect(s.grants[0].status).toBe("active");
});
test("P1 hypothesis prevents activation after a simulated deadline registration failure", () => {
  const s = finish(
    request(
      reducer(initialState(true), {
        type: "outcome",
        value: "schedule-failed",
      }),
    ),
  );
  expect(s.grants[0].status).toBe("failed");
  expect(s.observation).toBe("failed");
  const next = finish(
    reducer(reducer(s, { type: "outcome", value: "success" }), {
      type: "retry",
    }),
  );
  expect(next.grants[0].expiresAt).toBe(s.grants[0].expiresAt);
  expect(next.grants[0].status).toBe("active");
});
test("expired grants never become active even if a late result arrives", () => {
  let s = request();
  const oldId = s.operation!.id;
  s = reducer(s, { type: "advance", minutes: 5 });
  s = reducer(s, { type: "finish", id: oldId });
  expect(s.grants[0].status).toBe("expired");
  expect(liveGrant(s, "YouTube")).toBeUndefined();
});
test("P2 hypothesis shortens an existing grant on a new future boundary without reviving it", () => {
  let s = finish(request());
  s = reducer(s, { type: "advance", minutes: 1 });
  const focus = { ...s.rules[1], enabled: true, start: 723 };
  s = reducer(s, {
    type: "save",
    rules: [focus, s.rules[0], s.rules[2]],
    expectedRevision: s.revision,
  });
  expect(s.grants[0].expiresAt).toBe(EPOCH + 723 * MINUTE);
  s = finish(s);
  s = reducer(s, { type: "advance", minutes: 2 });
  expect(s.grants[0].status).toBe("expired");
  const restored = reconcileGrants({ ...s, rules: initialState(true).rules });
  expect(restored.grants[0].status).toBe("expired");
});
test("authorization revocation invalidates grants, and approval alone never resumes", () => {
  let s = finish(request());
  s = reducer(s, { type: "authorization", value: "denied" });
  expect(s.grants[0].status).toBe("invalidated");
  s = reducer(s, { type: "authorization", value: "approved" });
  expect(s.activation).toBe("awaiting");
  expect(request(s).grants).toHaveLength(1);
  s = finish(reducer(s, { type: "resume" }));
  expect(s.activation).toBe("enabled");
  expect(s.grants[0].status).toBe("invalidated");
});
test("stopping during an in-flight unlock rejects its late completion", () => {
  let s = request();
  const oldId = s.operation!.id;
  s = reducer(s, { type: "stop" });
  s = reducer(s, { type: "finish", id: oldId });
  expect(s.activation).toBe("paused");
  expect(s.grants[0].status).toBe("invalidated");
});
test("failed policy application keeps the new setting, stale revision cannot overwrite it", () => {
  let s = initialState(true);
  s = reducer(s, { type: "outcome", value: "failed" });
  const rules = s.rules.map((r) => ({ ...r, name: r.name + "変更" }));
  s = finish(reducer(s, { type: "save", rules, expectedRevision: 1 }));
  expect(s.rules).toEqual(rules);
  expect(s.revision).toBe(2);
  expect(s.observation).toBe("failed");
  s = reducer(s, { type: "save", rules: [], expectedRevision: 1 });
  expect(s.rules).toEqual(rules);
});
test("dummy money selection is required and deletion changes neither policy nor grants", () => {
  let s = reducer(initialState(true), { type: "advance", minutes: 600 });
  s = finish(s);
  const action = {
    type: "request" as const,
    app: "YouTube" as const,
    duration: 5,
    reason: "",
    amount: null,
  };
  expect(reducer(s, action).grants).toHaveLength(0);
  s = finish(reducer(s, { ...action, amount: 100 }));
  expect(s.grants[0].status).toBe("active");
  const result = reducer(s, { type: "deleteHistory" });
  expect(result.rules).toEqual(s.rules);
  expect(result.grants).toEqual(s.grants);
  expect(result.reasons).toHaveLength(0);
});

test("scenario reset cannot reuse an in-flight operation id", () => {
  const old = request();
  const fresh = request(reducer(old, { type: "reset", authorized: true }));
  expect(fresh.operation!.id).not.toBe(old.operation!.id);
  expect(reducer(fresh, { type: "finish", id: old.operation!.id })).toEqual(
    fresh,
  );
});
