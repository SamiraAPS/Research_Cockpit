// Real Chromium/Edge journeys using the built-in DevTools protocol, no npm browser dependency.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "../../site");
const candidates = [process.env.BROWSER_BIN, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
let executable;
for (const candidate of candidates) if (await access(candidate).then(() => true, () => false)) { executable = candidate; break; }
assert.ok(executable, "Set BROWSER_BIN to a Chromium/Edge executable");
await mkdir("work", { recursive: true });
const profile = await mkdtemp(path.resolve("work/browser-test-"));
const requests = [];
const server = createServer(async (req, res) => {
  try {
    const route = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${route === "/" ? "/index.html" : route}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    requests.push(route);
    const body = await readFile(file);
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let spawnError;
browser.on("error", error => { spawnError = error; });
let socket;
const errors = [];
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    const text = await readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    if (text) { port = Number(text.split("\n")[0]); break; }
    await delay(100);
  }
  assert.ok(port, "Browser did not start");
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) { const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id); if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result); }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.navigate", { url: base });
  await until('document.body?.dataset.dashboardState === "ready" || document.body?.dataset.dashboardState === "partial"');
  assert.equal(requests.filter(p => p.startsWith("/data/works/")).length, 0, "Initial render must use the index without loading full pages");
  await evaluate('location.hash="new"');
  await until('!document.querySelector("#view-new").hidden');
  await evaluate('document.querySelector("#work-query").value="no-such-work-xyz123"; document.querySelector("#work-query").dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelector("#work-result-count").textContent'), "0 Ergebnisse");
  await evaluate('document.querySelector("#reset-filters").click()');
  await until('document.querySelectorAll(".publication-card").length > 0');
  const workId = await evaluate('document.querySelector(".publication-card").dataset.workId');
  await evaluate('document.querySelector(".shortlist-button").click(); document.querySelector("#shortlist-only").checked=true; document.querySelector("#shortlist-only").dispatchEvent(new Event("change",{bubbles:true})); document.querySelector("#save-search").click()');
  assert.equal(await evaluate('document.querySelectorAll(".publication-card").length'), 1);
  await cdp("Page.reload");
  await until('document.body?.dataset.dashboardState === "ready" || document.body?.dataset.dashboardState === "partial"');
  await evaluate('document.querySelector("#restore-search").click()');
  assert.equal(await evaluate('document.querySelector(".publication-card").dataset.workId'), workId);
  assert.equal(await evaluate('document.querySelectorAll(".publication-card").length'), 1);
  await evaluate('document.querySelector(".publication-details").open=true');
  await until('document.querySelector(".abstract-copy") !== null');
  assert.ok(requests.some(p => p.startsWith("/data/works/")), "Opening details loads the original work");
  const downloads = path.join(profile, "downloads"); await mkdir(downloads, { recursive: true });
  await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await evaluate('document.querySelector("#export-csv").click()');
  let exported = "";
  for (let n = 0; n < 100; n++) { exported = await readFile(path.join(downloads, "human-ai-research-radar.csv"), "utf8").catch(() => ""); if (exported) break; await delay(100); }
  assert.ok(exported.includes(workId), "Export contains the selected publication");
  await evaluate('document.querySelector("#mark-reviewed").click(); document.querySelector("#filter-novelty").value="since-visit"; document.querySelector("#filter-novelty").dispatchEvent(new Event("change",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelector("#work-result-count").textContent'), "0 Ergebnisse");
  await cdp("Page.navigate", { url: `${base}/#new?work=${encodeURIComponent(workId)}` });
  await until('document.querySelectorAll(".publication-card").length === 1');
  assert.equal(await evaluate('document.querySelector(".publication-card").dataset.workId'), workId);
  await evaluate('location.hash="calls"');
  await until('!document.querySelector("#view-calls").hidden');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("#calls-table-body time")).every(t => t.textContent.startsWith(t.dateTime.slice(0,10)))'), true);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile("work/browser-mobile.png", Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(errors, [], "No unhandled browser exceptions");
  console.log("PASS: index-only startup, search/reset, shortlist/reload, saved search, lazy details, CSV, read-state, deep link, source deadlines, mobile render.");
} finally {
  socket?.close(); browser.kill(); server.close();
  await delay(1000);
  const expectedParent = path.resolve("work");
  if (path.dirname(profile) === expectedParent && path.basename(profile).startsWith("browser-test-")) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
