import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, legalWrenActions, summarize } from "./src/engine.mjs";
import { validateCapsule, describeCapsule, defaultCapsule } from "./src/capsule.mjs";
import { draftCapsule, MODEL } from "./src/nemotron.mjs";
import { publicWorld } from "./src/world.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4424);
const DATA = process.env.LT_DATA || join(here, "data", "session.json");

// One shared expedition. `capsule` is null until the absent player confirms it.
let session = load();
function fresh(prefill = null) { return { capsule: null, draft: prefill, commands: [], history: [] }; }
function load() {
  try { if (existsSync(DATA)) return JSON.parse(readFileSync(DATA, "utf8")); } catch {}
  return fresh();
}
function save() {
  try { mkdirSync(dirname(DATA), { recursive: true }); writeFileSync(DATA, JSON.stringify(session)); } catch {}
}

function view(state = null) {
  const s = session.capsule ? run(session.capsule, session.commands) : null;
  return {
    model: MODEL, hasKey: Boolean(process.env.NEBIUS_API_KEY),
    capsule: session.capsule, readable: session.capsule ? describeCapsule(session.capsule) : null,
    draft: session.draft, state: s, legal: s ? legalWrenActions(s) : [], summary: s ? summarize(s) : null,
    canRevise: Boolean(s),
  };
}

const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok, no) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/api/world") return send(res, 200, { ...publicWorld(), defaultCapsule: defaultCapsule() });
    if (req.method === "GET" && url.pathname === "/api/session") return send(res, 200, view());

    if (req.method === "POST" && url.pathname === "/api/capsule/draft") {
      const { text } = await body(req);
      if (!text || String(text).trim().length < 8) return send(res, 400, { error: "Write a sentence or two about how Ash should play." });
      try {
        const out = await draftCapsule(String(text).slice(0, 2000));
        const { capsule, issues } = validateCapsule(out.proposal);
        if (!capsule) return send(res, 422, { error: issues[0] });
        const questions = Array.isArray(out.proposal.questions) ? out.proposal.questions.filter((q) => typeof q === "string").slice(0, 4) : [];
        session.draft = capsule; save();
        return send(res, 200, { capsule, readable: describeCapsule(capsule), issues, questions, model: out.model, ms: out.ms });
      } catch (e) {
        return send(res, e.code === "no_key" ? 503 : 502, { error: e.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/capsule/preview") {
      const { capsule: raw } = await body(req);
      const { capsule, issues } = validateCapsule(raw);
      if (!capsule) return send(res, 422, { error: issues[0] });
      const out = { capsule, readable: describeCapsule(capsule), issues };
      if (session.capsule) {
        const before = run(session.capsule, session.commands), after = run(capsule, session.commands);
        out.compare = { before: compact(before), after: compact(after) };
      }
      return send(res, 200, out);
    }
    if (req.method === "POST" && url.pathname === "/api/capsule/confirm") {
      const { capsule: raw } = await body(req);
      const { capsule, issues } = validateCapsule(raw);
      if (!capsule) return send(res, 422, { error: issues[0] });
      if (!capsule.goals.length) return send(res, 422, { error: "Add at least one goal before confirming." });
      if (session.capsule) session.history.push({ capsule: session.capsule, replacedAtCommand: session.commands.length });
      session.capsule = capsule; session.draft = null; save();
      return send(res, 200, view());
    }
    if (req.method === "POST" && url.pathname === "/api/act") {
      if (!session.capsule) return send(res, 409, { error: "Confirm Ash's capsule first." });
      const { action } = await body(req);
      try { run(session.capsule, [...session.commands, { t: "wren", a: action }]); } catch (e) { return send(res, 400, { error: e.message }); }
      session.commands.push({ t: "wren", a: action }); save();
      return send(res, 200, view());
    }
    if (req.method === "POST" && url.pathname === "/api/resolve") {
      const { choice } = await body(req);
      const s = run(session.capsule, session.commands);
      if (!s.pause || !s.pause.options.some((o) => o.id === choice)) return send(res, 400, { error: "That decision is not open." });
      session.commands.push({ t: "resolve", choice }); save();
      return send(res, 200, view());
    }
    if (req.method === "POST" && url.pathname === "/api/next") {
      const { capsule: raw } = await body(req);
      const prefill = (raw && validateCapsule(raw).capsule) || session.capsule;
      session = fresh(prefill); save();
      return send(res, 200, view());
    }
    if (req.method === "POST" && url.pathname === "/api/reset") { session = fresh(); save(); return send(res, 200, view()); }

    if (req.method === "GET") {
      const p = url.pathname === "/" ? "/index.html" : url.pathname;
      const f = join(here, "public", p);
      if (!f.startsWith(join(here, "public")) || !existsSync(f)) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
      return res.end(readFileSync(f));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

function compact(s) {
  return { summary: summarize(s), ash: s.log.filter((e) => e.actor === "ash" || e.kind === "decision").map((e) => ({ day: e.day, kind: e.kind, text: e.text })) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, "127.0.0.1", () => console.log(`Later Together on http://127.0.0.1:${PORT}  (Nemotron key: ${process.env.NEBIUS_API_KEY ? "set" : "not set"})`));
}
