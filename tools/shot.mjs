// node tools/shot.mjs URL out.png [width height] [js-to-run-first]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [, , url, out, w = "1440", h = "900", pre = ""] = process.argv;
const W = +w, H = +h, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "sh-"))}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
let tabs; for (let k = 0; k < 60; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
await send("Page.navigate", { url }); await sleep(1800);
if (pre) { const r = await send("Runtime.evaluate", { expression: pre, awaitPromise: true }); if (r.result?.exceptionDetails) console.error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); await sleep(1500); }
const r = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(r.result.data, "base64")); chrome.kill(); process.exit(0);
