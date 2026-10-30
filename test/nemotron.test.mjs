import test from "node:test";
import assert from "node:assert/strict";
import { draftCapsule, extractJson, buildMessages } from "../src/nemotron.mjs";
import { validateCapsule } from "../src/capsule.mjs";

const reply = (content, ok = true, status = 200) => async () => ({ ok, status, json: async () => ({ model: "nvidia/test", choices: [{ message: { content } }], usage: { total_tokens: 5 } }) });

test("extractJson handles fences, prose and nested braces", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":{"b":"}"},"c":[1]}\n```'), { a: { b: "}" }, c: [1] });
  assert.throws(() => extractJson("no json"), /no JSON/);
  assert.throws(() => extractJson('{"a":'), /cut off/);
});

test("prompt names the schema and the player's text", () => {
  const m = buildMessages("keep 2 rope");
  assert.match(m[0].content, /"budgets"/);
  assert.match(m[1].content, /keep 2 rope/);
});

test("no key gives a graceful, coded error and makes no request", async () => {
  let called = false;
  await assert.rejects(draftCapsule("x", { apiKey: "", fetchImpl: async () => { called = true; } }), (e) => e.code === "no_key" && /by hand/.test(e.message));
  assert.equal(called, false);
});

test("a model proposal is parsed, then constrained by the app's validator", async () => {
  const bad = JSON.stringify({ goals: ["beacon", "moon"], budgets: { oil: 500, rations: 2, rope: 0 }, reserves: { oil: 1, rations: 1, rope: 1 }, situations: { flooded: "wait" }, allowed: ["move", "claim", "teleport"], questions: ["How much rope?"] });
  const out = await draftCapsule("go", { apiKey: "test", fetchImpl: reply("<think/>" + bad) });
  const { capsule, issues } = validateCapsule(out.proposal);
  assert.equal(capsule.budgets.oil, 12);
  assert.deepEqual(capsule.goals, ["beacon"]);
  assert.ok(issues.length >= 3);
});

test("HTTP failure becomes a readable error", async () => {
  await assert.rejects(draftCapsule("x", { apiKey: "k", fetchImpl: reply("", false, 429) }), /429/);
});
