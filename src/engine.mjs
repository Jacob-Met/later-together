// Deterministic expedition engine. State is always rebuilt from (capsule, commands), which is what
// makes the causal replay and "what if my capsule had said this" previews exact.
import { MAX_DAY, START_POOL, RESOURCES, NODES, GOALS, EDGES, FORECAST_TAGS, activeSituation, neighbors, edgeBetween } from "./world.mjs";

const HAZARD = { oil: 1 };
const add = (a, b) => { const o = { ...a }; for (const r of RESOURCES) o[r] = (o[r] || 0) + (b[r] || 0); return o; };
const zero = () => ({ oil: 0, rations: 0, rope: 0 });
const norm = (c) => { const o = zero(); for (const r of RESOURCES) o[r] = c?.[r] || 0; return o; };
const affordable = (pool, cost) => RESOURCES.every((r) => pool[r] >= (cost[r] || 0));
const fmt = (c) => RESOURCES.filter((r) => c[r]).map((r) => `${c[r]} ${r}`).join(", ") || "nothing";

export const stepCost = (edge, to, day) => (activeSituation(to, day) ? add(norm(edge.cost), HAZARD) : norm(edge.cost));

export function newState() {
  return {
    day: 1, pool: { ...START_POOL },
    loc: { wren: "camp", ash: "camp" },
    goalsDone: {}, spent: zero(), ashActions: 0, ashActedDay: 0, waited: 0,
    pause: null, ashStopped: false, over: null, pauseCount: 0, noted: {},
    stock: { cistern: { oil: 6 }, gallery: { rations: 6 }, bridge: { rope: 2 } },
    log: [],
  };
}

function push(s, e) { s.log.push({ i: s.log.length, day: s.day, ...e }); return e; }

function entry(s, actor, kind, text, why, before, extra = {}) {
  return push(s, { actor, kind, text, why: why || [], before, after: { ...s.pool }, loc: { ...s.loc }, ...extra });
}

function checkEnd(s) {
  if (s.over) return;
  if (Object.keys(GOALS).every((g) => s.goalsDone[g])) s.over = "All three goals done.";
  else if (s.day > MAX_DAY) s.over = "The season closed (day 14).";
}

// ---------- primitive actions shared by both players ----------
function doMove(s, who, to) {
  const from = s.loc[who];
  const edge = edgeBetween(from, to);
  if (!edge) throw new Error(`${NODES[to]?.name || to} is not next to ${NODES[from].name}.`);
  const cost = stepCost(edge, to, s.day);
  if (!affordable(s.pool, cost)) throw new Error(`Not enough supplies for that route (needs ${fmt(cost)}).`);
  const before = { ...s.pool };
  for (const r of RESOURCES) s.pool[r] -= cost[r];
  if (who === "ash") s.spent = add(s.spent, cost);
  s.loc[who] = to;
  return { cost, before, edge };
}
function doGather(s, who) {
  const node = s.loc[who];
  const st = s.stock[node];
  const res = st && Object.keys(st).find((r) => st[r] > 0);
  if (!res) throw new Error("Nothing left to gather here.");
  const before = { ...s.pool };
  const take = Math.min(NODES[node].gather[res], st[res]);
  st[res] -= take; s.pool[res] += take;
  return { before, res, take };
}
function doClaim(s, who, gid) {
  const node = s.loc[who];
  const g = GOALS[gid];
  if (!g || g.node !== node) throw new Error("That goal is not done from here.");
  if (s.goalsDone[gid]) throw new Error("Already done.");
  if (!affordable(s.pool, g.cost)) throw new Error(`Not enough supplies (needs ${fmt(g.cost)}).`);
  const before = { ...s.pool };
  for (const r of RESOURCES) s.pool[r] -= g.cost[r] || 0;
  if (who === "ash") s.spent = add(s.spent, norm(g.cost));
  s.goalsDone[gid] = who;
  return { before, g };
}

export function wrenAct(s, a) {
  if (s.over) throw new Error("The expedition is over.");
  const n = NODES[s.loc.wren].name;
  if (a.type === "move") {
    const { before, cost } = doMove(s, "wren", a.to);
    const sit = activeSituation(a.to, s.day);
    entry(s, "wren", "move", `Wren crosses to ${NODES[a.to].name}${sit ? ` (${sit.text.toLowerCase()})` : ""}. Costs ${fmt(cost)}.`, [], before);
  } else if (a.type === "gather") {
    const { before, res, take } = doGather(s, "wren");
    entry(s, "wren", "gather", `Wren gathers ${take} ${res} at ${n}.`, [], before);
  } else if (a.type === "claim") {
    const gid = Object.keys(GOALS).find((g) => GOALS[g].node === s.loc.wren && !s.goalsDone[g]);
    const { before, g } = doClaim(s, "wren", gid);
    entry(s, "wren", "claim", `Wren completes: ${g.name}.`, [], before);
  } else if (a.type === "rest") {
    entry(s, "wren", "rest", `Wren rests at ${n}.`, [], { ...s.pool });
  } else throw new Error("Unknown action.");
}

// ---------- Ash: acts only inside the confirmed capsule ----------
function route(s, c, from, to) {
  // Dijkstra on (crossings*100 + oil), avoiding forbidden places and "avoid" situations.
  const blocked = (n) => {
    if (n === from) return false;
    if (c.forbiddenNodes.includes(n)) return "forbidden";
    const sit = activeSituation(n, s.day);
    if (sit && c.situations[sit.tag] === "avoid") return `avoid:${sit.tag}`;
    return false;
  };
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  while (true) {
    const cur = Object.keys(dist).filter((n) => !done.has(n)).sort((a, b) => dist[a] - dist[b])[0];
    if (!cur) break;
    if (cur === to) break;
    done.add(cur);
    for (const { to: nx, edge } of neighbors(cur)) {
      if (blocked(nx)) continue;
      const w = 100 + stepCost(edge, nx, s.day).oil;
      if (dist[nx] === undefined || dist[cur] + w < dist[nx]) { dist[nx] = dist[cur] + w; prev[nx] = cur; }
    }
  }
  if (dist[to] === undefined) {
    const why = [];
    for (const n of Object.keys(NODES)) { const b = blocked(n); if (b) why.push(`${NODES[n].name} (${b.startsWith("avoid") ? FORECAST_TAGS[b.slice(6)] : "forbidden"})`); }
    return { path: null, why };
  }
  const path = []; let n = to;
  while (n !== from) { path.unshift(n); n = prev[n]; }
  let cost = zero(), at = from;
  for (const p of path) { cost = add(cost, stepCost(edgeBetween(at, p), p, s.day)); at = p; }
  return { path, cost };
}

function budgetCheck(s, c, cost) {
  const fails = [];
  for (const r of RESOURCES) {
    if (s.spent[r] + cost[r] > c.budgets[r]) fails.push(`${r}: would have spent ${s.spent[r] + cost[r]} of a ${c.budgets[r]} budget`);
    else if (s.pool[r] - cost[r] < c.reserves[r]) fails.push(`${r}: pool would drop to ${s.pool[r] - cost[r]}, under the reserve of ${c.reserves[r]}`);
  }
  return fails;
}
const budgetLine = (s, c, cost, r) => `${r}: spent ${s.spent[r]} + ${cost[r]} = ${s.spent[r] + cost[r]} of ${c.budgets[r]}; pool after ${s.pool[r] - cost[r]}, reserve ${c.reserves[r]}`;

function createPause(s, kind, text, why, planned, extra = {}) {
  s.pauseCount++;
  const p = { id: s.pauseCount, day: s.day, kind, text, planned, ...extra };
  p.options = [];
  if (planned) p.options.push({ id: "proceed", label: kind === "unfamiliar" ? "Let Ash go ahead this once" : "Let Ash do it this once" });
  p.options.push({ id: "hold", label: "Hold Ash here for a day" });
  p.options.push({ id: "stand_down", label: "Stand Ash down for the rest of this trip" });
  s.pause = p;
  entry(s, "ash", "pause", text, why, { ...s.pool }, { pauseId: p.id });
}

export function ashTurn(s, c) {
  if (s.over || s.ashStopped || s.ashActedDay === s.day) return;
  if (s.pause) {
    if (s.pause.day !== s.day) return;
    return;
  }
  const who = "ash";
  const here = s.loc.ash;
  const mark = () => { s.ashActedDay = s.day; };
  const once = (key, text, why) => { if (!s.noted[key]) { s.noted[key] = 1; entry(s, "ash", "idle", text, why, { ...s.pool }); } };

  if (s.ashActions >= c.maxActions) return once("limit", `Ash has used all ${c.maxActions} actions in the capsule and stays at ${NODES[here].name}.`, [{ clause: "maxActions", text: `${s.ashActions} of ${c.maxActions} actions used` }]);
  const remaining = c.goals.filter((g) => !s.goalsDone[g]);
  if (!remaining.length) return once("goals", `Every goal in the capsule is done, so Ash stays at ${NODES[here].name}.`, [{ clause: "goals", text: "No unfinished goals in the plan" }]);

  // optional resupply on the way
  if (c.allowed.includes("gather")) {
    const st = s.stock[here]; const res = st && Object.keys(st).find((r) => st[r] > 0);
    if (res && s.pool[res] < c.reserves[res] + 2) {
      const { before, take } = doGather(s, who);
      s.ashActions++; mark();
      return entry(s, "ash", "gather", `Ash gathers ${take} ${res} at ${NODES[here].name}.`, [
        { clause: "allowed", text: "Gathering is allowed" },
        { clause: `reserves.${res}`, text: `Pool had ${before[res]} ${res}, less than reserve ${c.reserves[res]} + 2` }], before);
    }
  }

  // choose the first goal that has a route and fits the budget and reserves
  const considered = []; let chosen = null;
  for (const gid of remaining) {
    const g = GOALS[gid];
    const rt = here === g.node ? { path: [], cost: zero() } : route(s, c, here, g.node);
    if (!rt.path) { considered.push({ clause: `goals.${gid}`, text: `${g.name}: no route (${rt.why.join(", ") || "none"})`, ok: false }); continue; }
    const total = add(rt.cost, norm(g.cost));
    const fails = budgetCheck(s, c, total);
    if (fails.length) { considered.push({ clause: `goals.${gid}`, text: `${g.name}: needs ${fmt(total)} in total, over the plan (${fails[0]})`, ok: false }); continue; }
    considered.push({ clause: `goals.${gid}`, text: `${g.name}: ${rt.path.length} crossing(s), ${fmt(total)} in total, fits budget and reserves`, ok: true });
    chosen = { gid, g, rt, total }; break;
  }
  if (!chosen) {
    return createPause(s, "no_plan", "Ash stops: no goal in the capsule can be reached within its budgets, reserves and route rules.", considered, null);
  }

  const { g, rt, gid } = chosen;
  const why = [...considered];
  if (!rt.path.length) {
    if (!c.allowed.includes("claim")) return createPause(s, "not_allowed", "Ash stops: the capsule does not allow working on goals.", why, null);
    const fails = budgetCheck(s, c, norm(g.cost));
    if (fails.length) return createPause(s, "no_plan", `Ash stops at ${NODES[here].name}: ${fails[0]}.`, why, null);
    const sit = activeSituation(here, s.day);
    if (sit && !c.situations[sit.tag]) return createPause(s, "unfamiliar", `Ash stops: ${sit.text}`, why, { type: "claim", goal: gid }, { tag: sit.tag, node: here });
    const { before } = doClaim(s, who, gid);
    s.ashActions++; s.waited = 0; mark();
    return entry(s, "ash", "claim", `Ash completes: ${g.name}.`, [...why,
      { clause: "allowed", text: "Working on goals is allowed" },
      ...RESOURCES.filter((r) => g.cost[r]).map((r) => ({ clause: `budgets.${r}`, text: budgetLine(s, c, { oil: 0, rations: 0, rope: 0 }, r) + ` (after paying ${g.cost[r]})` }))], before);
  }

  const to = rt.path[0];
  if (!c.allowed.includes("move")) return createPause(s, "not_allowed", "Ash stops: the capsule does not allow walking routes.", why, null);
  const edge = edgeBetween(here, to);
  const sit = activeSituation(to, s.day);
  const planned = { type: "move", to, goal: gid };
  if (sit) {
    const pol = c.situations[sit.tag];
    if (!pol) return createPause(s, "unfamiliar", `Ash stops before ${NODES[to].name}: ${sit.text} The capsule says nothing about this.`, [...why, { clause: "unfamiliar", text: `"${sit.tag.replace("_", " ")}" is not a situation the capsule covers`, ok: false }], planned, { tag: sit.tag, node: to });
    if (pol === "wait") {
      if (!c.allowed.includes("rest")) return createPause(s, "not_allowed", "Ash stops: told to wait, but resting is not allowed.", why, planned, { tag: sit.tag, node: to });
      if (s.waited < c.maxWaitDays) {
        s.waited++; s.ashActions++; mark();
        return entry(s, "ash", "hold", `Ash holds at ${NODES[here].name}: ${sit.text.toLowerCase()} (waiting day ${s.waited} of ${c.maxWaitDays}).`, [...why, { clause: `situations.${sit.tag}`, text: `Rule: wait, up to ${c.maxWaitDays} day(s)` }], { ...s.pool });
      }
      return createPause(s, "wait_exceeded", `Ash stops: waited ${c.maxWaitDays} day(s) and ${sit.text.toLowerCase()} is still there.`, [...why, { clause: `situations.${sit.tag}`, text: `Rule: wait, up to ${c.maxWaitDays} day(s); limit reached`, ok: false }], planned, { tag: sit.tag, node: to });
    }
  }
  const { before, cost } = doMove(s, who, to);
  s.ashActions++; s.waited = 0; mark();
  const w = [...why, { clause: "allowed", text: "Walking routes is allowed" }];
  if (route(s, { ...c, forbiddenNodes: [], situations: {} }, here, GOALS[gid].node).path?.join() !== rt.path.join()) {
    w.push({ clause: "forbiddenNodes", text: `Route chosen avoids ${[...c.forbiddenNodes.map((n) => NODES[n].name), ...Object.keys(c.situations).filter((t) => c.situations[t] === "avoid").map((t) => FORECAST_TAGS[t])].join(", ")} per the capsule` });
  }
  if (sit) w.push({ clause: `situations.${sit.tag}`, text: `Rule: proceed through ${FORECAST_TAGS[sit.tag]} (extra ${fmt(HAZARD)})` });
  for (const r of RESOURCES) if (cost[r]) w.push({ clause: `budgets.${r}`, text: `Step cost ${cost[r]} ${r}; running spend ${s.spent[r]} of ${c.budgets[r]}; pool ${s.pool[r]}, reserve ${c.reserves[r]}` });
  entry(s, "ash", "move", `Ash crosses to ${NODES[to].name} toward "${g.name}". Costs ${fmt(cost)}.`, w, before);
}

export function resolve(s, c, choice) {
  const p = s.pause;
  if (!p) return false;
  s.pause = null;
  const who = "ash";
  const label = p.options.find((o) => o.id === choice)?.label || choice;
  entry(s, "human", "decision", `Wren decided for Ash: ${label.toLowerCase()}. The capsule itself is unchanged.`, [{ clause: `pause #${p.id}`, text: p.text }], { ...s.pool }, { pauseId: p.id });
  s.ashActedDay = s.day;
  if (choice === "stand_down") { s.ashStopped = true; return true; }
  if (choice === "hold") { s.waited = 0; entry(s, "ash", "hold", `Ash holds at ${NODES[s.loc.ash].name}.`, [{ clause: "human decision", text: "Hold for a day" }], { ...s.pool }); return true; }
  if (choice === "proceed" && p.planned) {
    try {
      if (p.planned.type === "move") {
        const { before, cost } = doMove(s, who, p.planned.to);
        s.ashActions++; s.waited = 0;
        entry(s, "ash", "move", `Ash crosses to ${NODES[p.planned.to].name} on the human's one-time say-so. Costs ${fmt(cost)}.`, [{ clause: "human decision", text: "One-time exception; the budgets still count" }], before);
      } else if (p.planned.type === "claim") {
        const { before, g } = doClaim(s, who, p.planned.goal);
        s.ashActions++;
        entry(s, "ash", "claim", `Ash completes: ${g.name}, on the human's one-time say-so.`, [{ clause: "human decision", text: "One-time exception" }], before);
      }
    } catch (e) {
      entry(s, "system", "idle", `Ash could not go ahead: ${e.message}`, [], { ...s.pool });
    }
  }
  checkEnd(s);
  return true;
}

// ---------- the whole session ----------
export function run(capsule, commands) {
  const s = newState();
  for (const cmd of commands) {
    if (cmd.t === "wren") {
      wrenAct(s, cmd.a);
      checkEnd(s);
      if (!s.over) ashTurn(s, capsule);
      if (!s.over) { s.day++; checkEnd(s); }
      if (s.over) entry(s, "system", "end", s.over, [], { ...s.pool });
    } else if (cmd.t === "resolve") {
      if (s.pause) { resolve(s, capsule, cmd.choice); if (s.over) entry(s, "system", "end", s.over, [], { ...s.pool }); }
    }
  }
  return s;
}

export const legalWrenActions = (s) => {
  if (s.over) return [];
  const acts = neighbors(s.loc.wren).map(({ to, edge }) => ({ type: "move", to, cost: stepCost(edge, to, s.day), ok: affordable(s.pool, stepCost(edge, to, s.day)) }));
  const st = s.stock[s.loc.wren];
  if (st && Object.values(st).some((v) => v > 0)) acts.push({ type: "gather", ok: true });
  const g = Object.keys(GOALS).find((x) => GOALS[x].node === s.loc.wren && !s.goalsDone[x]);
  if (g) acts.push({ type: "claim", goal: g, cost: norm(GOALS[g].cost), ok: affordable(s.pool, GOALS[g].cost) });
  acts.push({ type: "rest", ok: true });
  return acts;
};

export function summarize(s) {
  const done = Object.keys(s.goalsDone);
  return { goalsDone: done.length, byWren: done.filter((g) => s.goalsDone[g] === "wren").length, byAsh: done.filter((g) => s.goalsDone[g] === "ash").length, pool: { ...s.pool }, pauses: s.pauseCount, day: s.day, over: s.over };
}
