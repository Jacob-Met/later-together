// Nemotron on Nebius Token Factory: turns a player's free-text strategy into a PROPOSED capsule.
// The app validates it (capsule.mjs) and the player confirms it; the model never acts on its own.
import { GOALS, NODES, FORECAST_TAGS, START_POOL } from "./world.mjs";

export const BASE_URL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
export const MODEL = process.env.NEMOTRON_MODEL || "nvidia/nemotron-3-super-120b-a12b";

export function buildMessages(text) {
  const goals = Object.entries(GOALS).map(([id, g]) => `  "${id}": ${g.name} at ${NODES[g.node].name}, costs ${JSON.stringify(g.cost)}`).join("\n");
  const places = Object.entries(NODES).filter(([id]) => id !== "camp").map(([id, n]) => `"${id}" (${n.name})`).join(", ");
  const system = `You convert a player's free-text strategy for a two-player co-op expedition into ONE JSON "contingency capsule" that a friend will play on their behalf while they are away. You are a translator, not the player: never invent goals, limits or preferences the text does not imply. If something is unclear, choose the SAFER (smaller budget, bigger reserve, "wait") value and add a short question to "questions".

World: resources are oil, rations, rope. The shared pool starts at ${JSON.stringify(START_POOL)}.
Goals (ids):
${goals}
Places you may forbid: ${places}.
Actions allowed (ids): "move" (walk routes), "claim" (work on goals), "gather" (collect supplies), "rest" (hold/rest).
Situations (ids): ${Object.entries(FORECAST_TAGS).map(([k, v]) => `"${k}" (${v})`).join(", ")}. Each gets one policy: "proceed" (go anyway), "avoid" (reroute, stop if none) or "wait" (hold position).

Output ONLY a JSON object, no prose, with exactly these keys:
{"goals":[ids in priority order],"allowed":[action ids],"forbiddenNodes":[place ids],"budgets":{"oil":n,"rations":n,"rope":n},"reserves":{"oil":n,"rations":n,"rope":n},"situations":{"loose_rock":policy,"high_wind":policy,"flooded":policy,"spore_bloom":policy},"maxWaitDays":n,"maxActions":n,"questions":[short strings]}
"budgets" is the most the absent player may spend from the shared pool. "reserves" is what must stay in the pool for the friend. "maxActions" is how many actions (1-14) the absent player may take in total.`;
  return [{ role: "system", content: system }, { role: "user", content: `Player's strategy:\n"""${text}"""` }];
}

export function extractJson(content) {
  if (typeof content !== "string") throw new Error("The model returned no text.");
  const t = content.replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("The model's reply contained no JSON object.");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("The model's JSON was cut off.");
}

export async function draftCapsule(text, { apiKey = process.env.NEBIUS_API_KEY, fetchImpl = fetch, model = MODEL, baseUrl = BASE_URL } = {}) {
  if (!apiKey) { const e = new Error("No NEBIUS_API_KEY is set on the server, so Nemotron cannot translate your strategy. Fill in the capsule by hand below."); e.code = "no_key"; throw e; }
  const t0 = Date.now();
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: buildMessages(text), max_tokens: 3000, temperature: 0.2 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) { const e = new Error(`Token Factory answered ${res.status}. Fill in the capsule by hand, or try again.`); e.code = "http"; throw e; }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  const proposal = extractJson(content);
  return { proposal, model: body.model || model, ms: Date.now() - t0, usage: body.usage || null };
}
