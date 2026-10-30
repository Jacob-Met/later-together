// Contingency capsule: the absent player's explicit plan. Validation and plain-English rendering
// are deterministic; a model may only PROPOSE a capsule, the player confirms what this file accepts.
import { GOALS, NODES, START_POOL, RESOURCES, FORECAST_TAGS } from "./world.mjs";

export const ACTIONS = { move: "walk a route", claim: "work on a goal", gather: "gather supplies", rest: "rest or hold" };
export const POLICIES = ["proceed", "avoid", "wait"];

export function defaultCapsule(owner = "Ash") {
  return {
    owner,
    goals: ["survey", "beacon"],
    allowed: ["move", "claim", "rest"],
    forbiddenNodes: ["shaft"],
    budgets: { oil: 8, rations: 5, rope: 0 },
    reserves: { oil: 3, rations: 3, rope: 2 },
    situations: { loose_rock: "avoid", high_wind: "wait", flooded: "wait", spore_bloom: "avoid" },
    maxWaitDays: 2,
    maxActions: 8,
  };
}

const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function validateCapsule(raw, owner = "Ash") {
  const issues = [];
  const base = defaultCapsule(owner);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { capsule: null, issues: ["The proposal was not a capsule object."] };
  }
  const c = { owner: String(raw.owner || owner).slice(0, 24) };

  const goalsIn = Array.isArray(raw.goals) ? raw.goals : [];
  c.goals = [];
  for (const g of goalsIn) {
    if (!GOALS[g]) issues.push(`Dropped unknown goal "${g}".`);
    else if (!c.goals.includes(g)) c.goals.push(g);
  }
  if (!c.goals.length) issues.push("No valid goals: Ash will only hold position until you add one.");

  const allowedIn = Array.isArray(raw.allowed) ? raw.allowed : [];
  c.allowed = [];
  for (const a of allowedIn) {
    if (!ACTIONS[a]) issues.push(`Dropped unknown action "${a}".`);
    else if (!c.allowed.includes(a)) c.allowed.push(a);
  }
  if (c.goals.length && !(c.allowed.includes("move") && c.allowed.includes("claim"))) {
    issues.push("Goals need both \"walk a route\" and \"work on a goal\" to be reachable.");
  }

  const fn = Array.isArray(raw.forbiddenNodes) ? raw.forbiddenNodes : [];
  c.forbiddenNodes = [];
  for (const n of fn) {
    if (!NODES[n]) issues.push(`Dropped unknown place "${n}".`);
    else if (n === "camp") issues.push("Lantern Camp cannot be forbidden; it is the start.");
    else if (!c.forbiddenNodes.includes(n)) c.forbiddenNodes.push(n);
  }
  for (const g of c.goals) {
    if (c.forbiddenNodes.includes(GOALS[g].node)) issues.push(`"${GOALS[g].name}" is at a forbidden place and can never be done.`);
  }

  c.budgets = {}; c.reserves = {};
  for (const r of RESOURCES) {
    const b = int(raw.budgets?.[r], 0, START_POOL[r], base.budgets[r]);
    const v = int(raw.reserves?.[r], 0, START_POOL[r], base.reserves[r]);
    if (raw.budgets && Number(raw.budgets[r]) !== b) issues.push(`Budget for ${r} adjusted to ${b} (the expedition starts with ${START_POOL[r]}).`);
    if (raw.reserves && Number(raw.reserves[r]) !== v) issues.push(`Reserve for ${r} adjusted to ${v}.`);
    if (b + v > START_POOL[r]) issues.push(`Ash's ${r} budget (${b}) and the reserve (${v}) exceed the starting ${START_POOL[r]}; the reserve will bind first.`);
    c.budgets[r] = b; c.reserves[r] = v;
  }

  c.situations = {};
  const sIn = raw.situations && typeof raw.situations === "object" ? raw.situations : {};
  for (const [tag, pol] of Object.entries(sIn)) {
    if (!FORECAST_TAGS[tag]) issues.push(`Dropped unknown situation "${tag}".`);
    else if (!POLICIES.includes(pol)) issues.push(`Policy "${pol}" for ${tag} is not proceed, avoid or wait; dropped.`);
    else c.situations[tag] = pol;
  }
  for (const tag of Object.keys(FORECAST_TAGS)) {
    if (!c.situations[tag]) {
      c.situations[tag] = "wait";
      issues.push(`No rule for ${FORECAST_TAGS[tag]}; set to "wait".`);
    }
  }
  c.maxWaitDays = int(raw.maxWaitDays, 0, 5, 2);
  c.maxActions = int(raw.maxActions, 1, 14, 8);
  return { capsule: c, issues };
}

const list = (a) => (a.length ? a.join(", ") : "nothing");
const resLine = (o) => RESOURCES.map((r) => `${o[r]} ${r}`).join(", ");

// The readable policy the player confirms. Built from validated data only, never from model prose.
export function describeCapsule(c) {
  const out = [];
  out.push({ key: "goals", label: "Goals, in order", text: c.goals.length ? c.goals.map((g, i) => `${i + 1}. ${GOALS[g].name}`).join("  ") : "None. I will only hold position." });
  out.push({ key: "allowed", label: "I may", text: list(c.allowed.map((a) => ACTIONS[a])) });
  out.push({ key: "forbidden", label: "I will not enter", text: list(c.forbiddenNodes.map((n) => NODES[n].name)) });
  out.push({ key: "budgets", label: "I may spend at most", text: resLine(c.budgets) + " from the shared pool" });
  out.push({ key: "reserves", label: "Always leave in the pool", text: resLine(c.reserves) });
  for (const [tag, label] of Object.entries(FORECAST_TAGS)) {
    const p = c.situations[tag];
    const verb = p === "proceed" ? "go on anyway" : p === "avoid" ? "take another route, and stop if there is none" : `hold up to ${c.maxWaitDays} day(s), then stop`;
    out.push({ key: `sit:${tag}`, label: `If there is ${label}`, text: verb });
  }
  out.push({ key: "unfamiliar", label: "Anything else unfamiliar", text: "Stop and ask a human. Never guess." });
  out.push({ key: "maxActions", label: "I act at most", text: `${c.maxActions} times` });
  return out;
}
