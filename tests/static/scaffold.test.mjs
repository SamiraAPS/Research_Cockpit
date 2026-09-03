import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const site = path.join(root, "site");

test("contains the static dashboard scaffold", async () => {
  const requiredPaths = [
    "index.html",
    "assets/css/styles.css",
    "assets/js/app.js",
    "assets/js/charts.js",
    "assets/js/search.js",
    ".nojekyll",
    "data",
  ];

  await Promise.all(requiredPaths.map((entry) => access(path.join(site, entry))));
});

test("uses relative static asset references compatible with a project page", async () => {
  const html = await readFile(path.join(site, "index.html"), "utf8");
  const app = await readFile(path.join(site, "assets/js/app.js"), "utf8");

  assert.match(html, /href="\.\/assets\/css\/styles\.css"/);
  assert.match(html, /src="\.\/assets\/js\/app\.js"/);
  assert.doesNotMatch(html, /(?:href|src)="\/assets\//);
  assert.match(app, /"\.\/data\/meta\.json"/);
  assert.doesNotMatch(app, /fetch\("\//);
});

test("provides all hash-routed dashboard views", async () => {
  const html = await readFile(path.join(site, "index.html"), "utf8");
  const views = ["overview", "new", "landscape", "emerging", "calls", "opportunities", "method"];

  for (const view of views) {
    assert.match(html, new RegExp(`href="#${view}"`));
    assert.match(html, new RegExp(`data-view="${view}"`));
  }
});

test("exposes semantic navigation and transparent UI states", async () => {
  const html = await readFile(path.join(site, "index.html"), "utf8");
  const app = await readFile(path.join(site, "assets/js/app.js"), "utf8");

  assert.match(html, /<nav class="primary-nav" aria-label="Dashboard-Bereiche">/);
  assert.match(html, /<main id="main-content"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Daten noch nicht verfügbar/);
  assert.match(app, /window\.addEventListener\("hashchange"/);
  assert.match(app, /aria-current/);
  for (const state of ["loading", "empty", "partial", "error"]) {
    assert.match(app, new RegExp(`"${state}"`));
  }
});

test("shows the last successful ingestion instead of substituting the export time", async () => {
  const html = await readFile(path.join(site, "index.html"), "utf8");
  const app = await readFile(path.join(site, "assets/js/app.js"), "utf8");

  assert.match(html, /Letzte erfolgreiche Ingestion/);
  assert.match(app, /meta\?\.lastSuccessfulIngestionAt/);
  assert.doesNotMatch(app, /freshness_value\.textContent\s*=\s*formatDate\(meta\?\.generatedAt/);
});
