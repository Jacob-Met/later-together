const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RES = ["oil", "rations", "rope"];
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
};
const SAMPLE = "Ash should survey the Mirror Cistern first, then relight the lighthouse beacon. Stay out of the Collapsed Shaft. Spend at most 8 oil and 5 rations, and leave Wren at least 3 oil, 3 rations and 2 rope. Wait out wind and flooding for a couple of days, walk around spore clouds. If anything strange shows up, stop and ask.";

let W, S, tab = "play", sel = null, cap = null, prev = null, nem = null, busy = false, strategy = SAMPLE, revising = false, revisePreview = null;
const fmtCost = (c) => RES.filter((r) => c && c[r]).map((r) => `${c[r]} ${r}`).join(", ") || "free";
const tagName = (t) => (W.FORECAST_TAGS[t] || t.replace("_", " "));

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 6000);
}

async function boot() {
  W = await api("/api/world");
  await refresh();
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { tab = b.dataset.tab; sel = null; render(); } });
}
async function refresh(data) {
  S = data || (await api("/api/session"));
  if (!S.capsule && !cap) cap = structuredClone(S.draft || W.defaultCapsule);
  render();
  if (!S.capsule && !prev) updatePreview();
}

// ---------- header + map ----------
function render() {
  const st = S.state;
  const entry = tab === "replay" && sel != null && st ? st.log[sel] : null;
  const day = entry ? entry.day : st ? Math.min(st.day, W.MAX_DAY) : 1;
  const pool = entry ? entry.after : st ? st.pool : W.START_POOL;
  $("#gauges").innerHTML = `<div class="g day"><i>Day</i><b>${day}</b><i>/ ${W.MAX_DAY}</i></div>` + RES.map((r) => {
    const n = pool[r], max = W.START_POOL[r];
    return `<div class="g" title="${r}"><i>${r}</i><span class="pips" aria-hidden="true">${Array.from({ length: Math.max(max, n) }, (_, i) => `<s class="${i < n ? "" : "off"}"></s>`).join("")}</span><b>${n}</b></div>`;
  }).join("");
  const playing = Boolean(S.capsule);
  $("#tabs").style.display = playing ? "" : "none";
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  drawMap(st, entry, day);
  const side = $("#side");
  if (!playing) side.innerHTML = setupHTML();
  else side.innerHTML = tab === "play" ? playHTML() : replayHTML();
  bind();
}

function drawMap(st, entry, day) {
  const loc = entry ? entry.loc : st ? st.loc : { wren: "camp", ash: "camp" };
  const c = S.capsule || cap;
  const act = new Set((tab === "play" && st && !st.over ? S.legal : []).filter((a) => a.type === "move" && a.ok).map((a) => a.to));
  const sits = W.SITUATIONS.filter((s) => day >= s.from && day <= s.to);
  const done = st ? (entry ? goalsAt(st, entry.i) : st.goalsDone) : {};
  let svg = "";
  for (const e of W.EDGES) {
    const a = W.NODES[e.a], b = W.NODES[e.b];
    const cut = c && (c.forbiddenNodes.includes(e.a) || c.forbiddenNodes.includes(e.b));
    svg += `<line class="edge ${cut ? "cut" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    svg += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}" fill="#7d8a95" font-size="11" text-anchor="middle" font-family="ui-monospace,monospace">${esc(fmtCost(e.cost).replace(/ (oil|rations|rope)/g, (m, r) => ({ oil: "o", rations: "r", rope: "p" }[r])).replace(/(\d) ?([orp])/g, "$1$2").replace(/, /g, " "))}</text>`;
  }
  for (const [id, n] of Object.entries(W.NODES)) {
    const sit = sits.find((s) => s.node === id);
    const g = n.goal;
    const canGo = act.has(id);
    const forbid = c && c.forbiddenNodes.includes(id);
    svg += `<g class="node ${canGo ? "go" : ""} ${forbid ? "forbid" : ""}" data-node="${id}" ${canGo ? `tabindex="0" role="button" aria-label="Wren goes to ${esc(n.name)}"` : ""}>`;
    if (sit) svg += `<circle class="hazard" cx="${n.x}" cy="${n.y}" r="31"/>`;
    svg += `<circle class="ring" cx="${n.x}" cy="${n.y}" r="22"/>`;
    if (g) svg += `<path class="goalmark ${done[g] ? "done" : ""}" d="M${n.x - 5} ${n.y + 8} V${n.y - 9} L${n.x + 9} ${n.y - 4} L${n.x - 5} ${n.y + 1}"/>`;
    else if (n.gather) svg += `<circle cx="${n.x}" cy="${n.y}" r="4" fill="#5b6d7b"/>`;
    svg += `<text x="${n.x}" y="${n.y + 44}">${esc(n.name)}</text>`;
    if (sit) svg += `<text class="sub" x="${n.x}" y="${n.y + 59}" fill="#ff8f7a" style="fill:#ff8f7a">${esc(tagName(sit.tag))}</text>`;
    else if (forbid) svg += `<text class="sub" x="${n.x}" y="${n.y + 59}">off limits for Ash</text>`;
    svg += `</g>`;
  }
  const tok = (who, color, dx) => {
    const n = W.NODES[loc[who]];
    return `<g class="tok" style="transform:translate(${n.x + dx}px,${n.y - 3}px)"><circle r="9" fill="${color}" stroke="#0d1217" stroke-width="2.5"/><text y="4" text-anchor="middle" font-size="11" font-weight="700" fill="#0d1217" style="stroke:none;fill:#0d1217">${who === "wren" ? "W" : "A"}</text></g>`;
  };
  svg += tok("wren", "#5fd3c8", -12) + tok("ash", "#f3b53f", 12);
  $("#map").innerHTML = svg;
  $("#legend").innerHTML = `<span class="w">Wren (playing now)</span><span class="a">Ash (away, follows the capsule)</span><span class="h">Active situation</span><span>Route labels: o oil, r rations, p rope</span>`;
}
function goalsAt(st, i) {
  const o = {};
  for (const e of st.log.slice(0, i + 1)) if (e.kind === "claim") { const g = Object.keys(W.GOALS).find((k) => e.text.includes(W.GOALS[k].name)); if (g) o[g] = e.actor; }
  return o;
}

// ---------- setup ----------
function setupHTML() {
  return `<h2>Before you leave</h2>
  <h3>Ash's contingency capsule</h3>
  <p class="mute small">You're Ash, about to be away. Wren will carry on the expedition. Ash will only act inside the plan you confirm here, and will stop and ask Wren when something isn't covered.</p>
  <label for="strategy" class="small mute">Say how Ash should play, in your own words</label>
  <textarea id="strategy">${esc(strategy)}</textarea>
  <div class="row" style="margin-top:8px"><button class="btn" id="draft" ${busy ? "disabled" : ""}>${busy ? "Nemotron is reading…" : "Translate with Nemotron"}</button>
  <span class="small mute">${S.hasKey ? "Model proposes, the rules below decide." : "No API key on this server. Edit the capsule by hand."}</span></div>
  ${nem ? nemHTML() : ""}
  <h2>Here is what Ash will do</h2>
  <ul class="policy" id="policy">${policyHTML(prev?.readable)}</ul>
  ${prev?.issues?.length ? `<div class="note">${prev.issues.map(esc).join("<br>")}</div>` : ""}
  <details ${nem ? "" : "open"}><summary>Edit the capsule directly</summary>${formHTML(cap)}</details>
  <div class="row" style="margin-top:14px"><button class="btn" id="confirm">I confirm this plan. Ash leaves.</button></div>`;
}
function nemHTML() {
  if (nem.error) return `<div class="note err">${esc(nem.error)}</div>`;
  return `<div class="note"><b>Nemotron's proposal is loaded.</b> Check it below before you confirm.
  ${nem.questions?.length ? `<br>It was unsure about: ${nem.questions.map(esc).join(" · ")}` : ""}
  <div class="proof">${esc(nem.model)} · ${(nem.ms / 1000).toFixed(1)}s via Nebius Token Factory</div></div>`;
}
const policyHTML = (r) => (r || []).map((x) => `<li><span>${esc(x.label)}</span><span>${esc(x.text)}</span></li>`).join("");

function formHTML(c) {
  const order = [...c.goals, ...Object.keys(W.GOALS).filter((g) => !c.goals.includes(g))];
  return `<div class="form" id="form">
  <fieldset><legend>Goals, in priority order</legend>${order.map((g, i) => `<div class="goalrow"><label><input type="checkbox" data-goal="${g}" ${c.goals.includes(g) ? "checked" : ""}> ${esc(W.GOALS[g].name)}</label>
    ${c.goals.includes(g) ? `<span class="mv"><button data-up="${g}" aria-label="Move ${esc(W.GOALS[g].name)} up">↑</button> <button data-down="${g}" aria-label="Move ${esc(W.GOALS[g].name)} down">↓</button></span>` : ""}</div>`).join("")}</fieldset>
  <fieldset><legend>Ash may</legend>${[["move", "walk routes"], ["claim", "work on goals"], ["gather", "gather supplies"], ["rest", "rest and hold"]].map(([k, l]) => `<label><input type="checkbox" data-allow="${k}" ${c.allowed.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</fieldset>
  <fieldset><legend>Ash will not enter</legend>${Object.entries(W.NODES).filter(([id]) => id !== "camp").map(([id, n]) => `<label><input type="checkbox" data-forbid="${id}" ${c.forbiddenNodes.includes(id) ? "checked" : ""}> ${esc(n.name)}</label>`).join("")}</fieldset>
  <fieldset><legend>Most Ash may spend / least left in the pool</legend><div class="grid3">${RES.map((r) => `<label>${r}<input type="number" min="0" max="${W.START_POOL[r]}" data-budget="${r}" value="${c.budgets[r]}" aria-label="${r} budget"></label>`).join("")}</div>
  <div class="grid3" style="margin-top:6px">${RES.map((r) => `<label>keep<input type="number" min="0" max="${W.START_POOL[r]}" data-reserve="${r}" value="${c.reserves[r]}" aria-label="${r} reserve"></label>`).join("")}</div></fieldset>
  <fieldset><legend>When this happens</legend>${Object.entries(W.FORECAST_TAGS).map(([t, l]) => `<div class="goalrow"><span>${l}</span><select data-sit="${t}" class="mv" style="width:auto">${["proceed", "avoid", "wait"].map((p) => `<option ${c.situations[t] === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>`).join("")}
  <div class="grid3" style="margin-top:6px"><label>wait at most (days)<input type="number" min="0" max="5" data-field="maxWaitDays" value="${c.maxWaitDays}"></label><label>total actions<input type="number" min="1" max="14" data-field="maxActions" value="${c.maxActions}"></label></div></fieldset></div>`;
}
function readForm(c) {
  const f = $("#form"); if (!f) return c;
  const out = structuredClone(c);
  out.goals = c.goals.filter((g) => f.querySelector(`[data-goal="${g}"]`)?.checked);
  for (const el of f.querySelectorAll("[data-goal]")) if (el.checked && !out.goals.includes(el.dataset.goal)) out.goals.push(el.dataset.goal);
  out.allowed = [...f.querySelectorAll("[data-allow]")].filter((e) => e.checked).map((e) => e.dataset.allow);
  out.forbiddenNodes = [...f.querySelectorAll("[data-forbid]")].filter((e) => e.checked).map((e) => e.dataset.forbid);
  for (const e of f.querySelectorAll("[data-budget]")) out.budgets[e.dataset.budget] = Number(e.value);
  for (const e of f.querySelectorAll("[data-reserve]")) out.reserves[e.dataset.reserve] = Number(e.value);
  for (const e of f.querySelectorAll("[data-sit]")) out.situations[e.dataset.sit] = e.value;
  for (const e of f.querySelectorAll("[data-field]")) out[e.dataset.field] = Number(e.value);
  return out;
}
async function updatePreview() {
  try {
    prev = await api("/api/capsule/preview", { capsule: cap });
    const el = $("#policy"); if (el) el.innerHTML = policyHTML(prev.readable);
    if (revising) { revisePreview = prev; render(); }
  } catch (e) { toast(e.message); }
}

// ---------- play ----------
function actLabel(a) {
  if (a.type === "move") return [`Go to ${W.NODES[a.to].name}`, fmtCost(a.cost)];
  if (a.type === "gather") return ["Gather supplies here", "+ supplies"];
  if (a.type === "claim") return [`Complete: ${W.GOALS[a.goal].name}`, fmtCost(a.cost)];
  return ["Rest a day", "free"];
}
function playHTML() {
  const st = S.state; let h = "";
  if (st.over) h += `<div class="end"><h3>${esc(st.over)}</h3><p class="small">${S.summary.goalsDone} of 3 goals done (Wren ${S.summary.byWren}, Ash ${S.summary.byAsh}). ${S.summary.pauses} time(s) Ash stopped to ask. Open the Replay to see why every step happened.</p><button class="btn" data-go="replay">Open the replay</button></div>`;
  if (st.pause) {
    const e = st.log.find((x) => x.pauseId === st.pause.id && x.kind === "pause");
    h += `<div class="pause" role="alert"><h3>Ash has stopped</h3><p>${esc(st.pause.text)}</p>
    <ul class="why">${(e?.why || []).filter((w) => w.ok === false || w.clause === "unfamiliar").map(whyLi).join("")}</ul>
    <p class="small mute">Ash's capsule can't answer this, so a person decides. Your answer is recorded and does not rewrite the capsule.</p>
    <div class="opts">${st.pause.options.map((o) => `<button class="btn ${o.id === "proceed" ? "" : "ghost"}" data-resolve="${o.id}">${esc(o.label)}</button>`).join("")}</div></div>`;
  }
  if (!st.over) {
    h += `<h2>Your move, Wren · day ${st.day}</h2><div class="acts">${S.legal.map((a, i) => { const [l, c] = actLabel(a); return `<button class="act" data-act='${esc(JSON.stringify({ type: a.type, to: a.to }))}' ${a.ok ? "" : "disabled"}><span>${esc(l)}</span><small>${esc(c)}</small></button>`; }).join("")}</div>`;
    h += `<p class="small mute" style="margin-top:8px">After you act, Ash takes one capsule step${st.pause ? " (not while stopped)" : ""}.</p>`;
  }
  const c = S.capsule;
  h += `<h2>Ash, following the capsule</h2><p class="small">At <b>${esc(W.NODES[st.loc.ash].name)}</b>. Spent ${RES.map((r) => `${st.spent[r]}/${c.budgets[r]} ${r}`).join(" · ")}. Actions ${st.ashActions}/${c.maxActions}.</p>`;
  h += `<h2>What happened</h2><ul class="feed">${st.log.slice(-9).reverse().map(feedLi).join("")}</ul><p style="margin-top:10px"><button class="btn ghost" data-go="replay">Open causal replay</button></p>`;
  return h;
}
const feedLi = (e) => `<li><span class="d">d${e.day}</span><span><span class="who ${e.actor}">${e.actor === "human" ? "Decision" : e.actor === "system" ? "" : e.actor === "wren" ? "Wren" : "Ash"}</span> ${esc(e.text.replace(/^(Wren|Ash) /, e.actor === "human" || e.actor === "system" ? "$1 " : ""))}</span></li>`;
const whyLi = (w) => `<li class="${w.ok === true ? "ok" : w.ok === false ? "no" : ""}"><span class="cl">${esc(w.clause)}</span>${esc(w.text)}</li>`;

// ---------- replay ----------
function replayHTML() {
  const st = S.state; const log = st.log;
  if (sel == null || !log[sel]) sel = log.length ? log.length - 1 : null;
  let h = `<h2>Causal replay</h2><p class="small mute">Pick any step. For Ash, the clauses of the confirmed capsule that allowed, shaped or stopped it are listed.</p>`;
  const e = sel != null ? log[sel] : null;
  if (e) {
    h += `<div class="note"><b class="who ${e.actor}">${e.actor === "human" ? "Wren, deciding for Ash" : e.actor === "wren" ? "Wren" : e.actor === "ash" ? "Ash" : "System"}</b> · day ${e.day}<br>${esc(e.text)}
    <div class="proof">pool ${RES.map((r) => `${r} ${e.before[r]}→${e.after[r]}`).join(" · ")}</div></div>`;
    h += e.actor === "wren" ? `<p class="small mute">A live choice by Wren; the capsule is not involved.</p>` : e.why.length ? `<ul class="why">${e.why.map(whyLi).join("")}</ul>` : "";
  }
  h += `<ul class="tl" style="margin-top:12px">${log.map((x, i) => `<li><button data-sel="${i}" ${i === sel ? 'aria-current="true"' : ""}><span class="mute">d${x.day}</span><span class="dot ${x.actor}"></span><span class="${x.kind === "pause" ? "pausemark" : ""}">${esc(x.text)}</span></button></li>`).join("")}</ul>`;
  h += `<h2>When you're back</h2>`;
  if (!revising) h += `<p class="small mute">Change the capsule and see what it would have done with the same moves by Wren and the same decisions.</p><button class="btn" data-revise="1">Revise Ash's capsule</button>`;
  else {
    h += `<p class="small mute">Edit, then compare. Nothing here changes the finished history.</p>${formHTML(cap)}
    <ul class="policy" id="policy" style="margin-top:10px">${policyHTML(revisePreview?.readable)}</ul>
    ${revisePreview?.issues?.length ? `<div class="note">${revisePreview.issues.map(esc).join("<br>")}</div>` : ""}
    ${revisePreview?.compare ? cmpHTML(revisePreview.compare) : ""}
    <div class="row" style="margin-top:12px"><button class="btn" data-next="1">Use this for the next expedition</button><button class="btn ghost" data-revise="0">Cancel</button></div>`;
  }
  return h;
}
function cmpHTML(c) {
  const col = (t, x) => `<div><h4>${t}</h4><b>${x.summary.goalsDone} of 3 goals</b> · pool ${RES.map((r) => `${x.summary.pool[r]} ${r}`).join(", ")} · ${x.summary.pauses} stop(s)<ul>${x.ash.slice(0, 12).map((a) => `<li class="small">d${a.day} ${esc(a.text.replace(/^Ash /, ""))}</li>`).join("")}</ul></div>`;
  return `<h2>Same trip, two capsules</h2><div class="cmp">${col("Confirmed capsule", c.before)}${col("Revised capsule", c.after)}</div>`;
}

// ---------- events ----------
function bind() {
  const side = $("#side");
  $("#draft")?.addEventListener("click", async () => {
    strategy = $("#strategy").value; busy = true; nem = null; render();
    try {
      const r = await api("/api/capsule/draft", { text: strategy });
      cap = r.capsule; prev = r; nem = { model: r.model, ms: r.ms, questions: r.questions };
    } catch (e) { nem = { error: e.message }; }
    busy = false; render();
  });
  $("#confirm")?.addEventListener("click", async () => {
    try { cap = readForm(cap); await refresh(await api("/api/capsule/confirm", { capsule: cap })); tab = "play"; render(); } catch (e) { toast(e.message); }
  });
  side.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => doAct(JSON.parse(b.dataset.act))));
  side.querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", async () => { try { await refresh(await api("/api/resolve", { choice: b.dataset.resolve })); } catch (e) { toast(e.message); } }));
  side.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.go; sel = null; render(); }));
  side.querySelectorAll("[data-sel]").forEach((b) => b.addEventListener("click", () => { sel = Number(b.dataset.sel); render(); }));
  side.querySelectorAll("[data-revise]").forEach((b) => b.addEventListener("click", () => { revising = b.dataset.revise === "1"; if (revising) { cap = structuredClone(S.capsule); revisePreview = null; updatePreview(); } render(); }));
  side.querySelector("[data-next]")?.addEventListener("click", async () => {
    try { cap = readForm(cap); const r = await api("/api/next", { capsule: cap }); cap = structuredClone(r.draft); revising = false; revisePreview = null; prev = null; nem = null; tab = "play"; await refresh(r); } catch (e) { toast(e.message); }
  });
  const form = $("#form");
  if (form) {
    form.addEventListener("click", (e) => {
      const up = e.target.dataset?.up, dn = e.target.dataset?.down;
      if (!up && !dn) return;
      cap = readForm(cap); const g = cap.goals, i = g.indexOf(up || dn), j = up ? i - 1 : i + 1;
      if (j >= 0 && j < g.length) { [g[i], g[j]] = [g[j], g[i]]; }
      render(); updatePreview();
    });
    form.addEventListener("change", (e) => {
      const rerender = e.target.dataset.goal;
      cap = readForm(cap);
      if (rerender) { render(); }
      updatePreview();
    });
  }
  document.querySelectorAll("#map .node.go").forEach((n) => {
    const go = () => doAct({ type: "move", to: n.dataset.node });
    n.addEventListener("click", go);
    n.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}
async function doAct(action) {
  try { await refresh(await api("/api/act", { action })); } catch (e) { toast(e.message); }
}
boot();
