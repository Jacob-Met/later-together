import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.LT_DATA = join(mkdtempSync(join(tmpdir(), "lt-")), "s.json");
delete process.env.NEBIUS_API_KEY;
const { server } = await import("../server.mjs");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (p, b) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
test.after(() => server.close());

test("acting is blocked until a capsule is confirmed", async () => {
  assert.equal((await post("/api/act", { action: { type: "rest" } })).status, 409);
});
test("drafting without a key degrades gracefully", async () => {
  const r = await post("/api/capsule/draft", { text: "survey the cistern then stop" });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /NEBIUS_API_KEY/);
});
test("confirm, play, pause-free round trip, revise preview, next expedition", async () => {
  const w = await (await fetch(base + "/api/world")).json();
  let r = await post("/api/capsule/confirm", { capsule: w.defaultCapsule });
  assert.equal(r.status, 200);
  assert.ok(r.body.readable.length > 5);
  r = await post("/api/act", { action: { type: "rest" } });
  assert.equal(r.body.state.log.filter((e) => e.actor === "ash").length, 1);
  assert.equal((await post("/api/act", { action: { type: "move", to: "vault" } })).status, 400);
  const cmp = await post("/api/capsule/preview", { capsule: { ...w.defaultCapsule, goals: ["survey"] } });
  assert.ok(cmp.body.compare.before && cmp.body.compare.after);
  const next = await post("/api/next", { capsule: { ...w.defaultCapsule, goals: ["survey"] } });
  assert.equal(next.body.capsule, null);
  assert.deepEqual(next.body.draft.goals, ["survey"]);
});
