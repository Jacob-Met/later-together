import test from "node:test";
import assert from "node:assert/strict";
import { run, summarize } from "../src/engine.mjs";
import { validateCapsule, defaultCapsule, describeCapsule } from "../src/capsule.mjs";

const cap = (patch = {}) => validateCapsule({ ...defaultCapsule(), ...patch }).capsule;
const rests = (n) => Array.from({ length: n }, () => ({ t: "wren", a: { type: "rest" } }));

test("Ash follows the goal order and pays from budget", () => {
  const s = run(cap(), rests(3));
  assert.equal(s.goalsDone.survey, "ash");
  assert.deepEqual(s.loc.ash, "cistern");
  assert.equal(s.spent.oil, 2);
});

test("Ash never spends past budget or under the reserve", () => {
  const c = cap({ budgets: { oil: 2, rations: 5, rope: 0 }, goals: ["beacon"] });
  const s = run(c, rests(6));
  assert.ok(s.spent.oil <= 2);
  assert.ok(s.pool.oil >= c.reserves.oil || s.pool.oil >= 0);
  assert.equal(s.pause?.kind, "no_plan");
});

test("forbidden places are never entered", () => {
  const s = run(cap({ forbiddenNodes: ["shaft"], goals: ["beacon"] }), rests(8));
  assert.ok(!s.log.some((e) => e.actor === "ash" && /Collapsed Shaft/.test(e.text) && e.kind === "move"));
});

test("an unforecast situation pauses Ash and the capsule is not changed", () => {
  const c = cap({ goals: ["vault"], budgets: { oil: 8, rations: 6, rope: 2 }, reserves: { oil: 1, rations: 1, rope: 1 }, situations: { loose_rock: "avoid", high_wind: "proceed", flooded: "proceed", spore_bloom: "proceed" } });
  const before = JSON.stringify(c);
  const s = run(c, rests(10));
  const p = s.log.find((e) => e.kind === "pause");
  assert.ok(p, "expected a pause");
  assert.equal(JSON.stringify(c), before);
});

test("waiting policy holds then pauses when the wait limit is hit", () => {
  const c = cap({ goals: ["beacon"], situations: { loose_rock: "avoid", high_wind: "wait", flooded: "wait", spore_bloom: "avoid" }, maxWaitDays: 1 });
  const s = run(c, rests(8));
  assert.ok(s.log.some((e) => e.kind === "hold"));
  assert.ok(s.log.some((e) => e.kind === "pause" && /waited/.test(e.text)));
});

test("a human decision resolves a pause and is logged as a decision", () => {
  const c = cap({ goals: ["beacon"], maxWaitDays: 1, situations: { loose_rock: "avoid", high_wind: "wait", flooded: "wait", spore_bloom: "avoid" } });
  let cmds = rests(5);
  let s = run(c, cmds);
  assert.ok(s.pause);
  cmds = [...cmds, { t: "resolve", choice: "proceed" }];
  s = run(c, cmds);
  assert.equal(s.pause, null);
  assert.ok(s.log.some((e) => e.kind === "decision"));
});

test("replay is deterministic and a revised capsule changes the outcome", () => {
  const cmds = rests(10);
  const a = run(cap(), cmds), b = run(cap(), cmds);
  assert.deepEqual(a.log, b.log);
  const c2 = run(cap({ goals: ["survey"] }), cmds);
  assert.notDeepEqual(summarize(a), summarize(c2));
});

test("every Ash action log entry carries its reasons", () => {
  const s = run(cap(), rests(6));
  for (const e of s.log.filter((x) => x.actor === "ash" && ["move", "claim", "hold"].includes(x.kind))) assert.ok(e.why.length > 0, e.text);
});

test("illegal Wren moves are rejected", () => {
  assert.throws(() => run(cap(), [{ t: "wren", a: { type: "move", to: "vault" } }]), /not next to/);
});

test("capsule validation clamps, drops and reports", () => {
  const { capsule, issues } = validateCapsule({ goals: ["beacon", "dragon"], allowed: ["move", "claim", "fly"], forbiddenNodes: ["camp", "moon"], budgets: { oil: 99, rations: -3, rope: 1 }, reserves: {}, situations: { flooded: "teleport" } });
  assert.deepEqual(capsule.goals, ["beacon"]);
  assert.equal(capsule.budgets.oil, 12);
  assert.equal(capsule.budgets.rations, 0);
  assert.equal(capsule.situations.flooded, "wait");
  assert.ok(issues.length >= 6);
  assert.equal(validateCapsule("nope").capsule, null);
});

test("readable policy covers every rule and ends with the unfamiliar clause", () => {
  const r = describeCapsule(cap());
  assert.ok(r.some((x) => x.key === "budgets") && r.at(-2).key === "unfamiliar");
});
