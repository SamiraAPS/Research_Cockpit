import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { createTestD1 } from "./helpers/d1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const [pageOne, pageTwo, arxivXml] = await Promise.all([
  fixture("openalex-page-1.json").then(JSON.parse),
  fixture("openalex-page-2.json").then(JSON.parse),
  fixture("arxiv-feed.xml"),
]);
const callFixtures = Object.fromEntries(await Promise.all([
  ["acm-chi-2027", "calls-acm-chi-2027.html"],
  ["ahfe-2027", "calls-ahfe-2027.html"],
  ["elsevier-safety-science", "calls-elsevier-safety-science.html"],
  ["sage-human-relations", "calls-sage-human-relations.html"],
].map(async ([key, filename]) => [key, await fixture(filename)])));

const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const { runIngestion } = await vite.ssrLoadModule("/lib/radar/ingestion.ts");
const { runCallsIngestion } = await vite.ssrLoadModule("/lib/calls/ingestion.ts");
const { OFFICIAL_CALL_SOURCES } = await vite.ssrLoadModule("/lib/calls/config/sources.v1.ts");
const { readRadarData } = await vite.ssrLoadModule("/lib/radar/repository.ts");

after(async () => {
  await vite.close();
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

function releaseFixtureFetch(input) {
  const url = new URL(String(input));
  if (url.hostname === "api.openalex.org") {
    if (url.searchParams.has("group_by")) {
      return jsonResponse({
        meta: { count: 150 },
        group_by: [
          { key: 2022, count: 20 },
          { key: 2023, count: 30 },
          { key: 2024, count: 40 },
          { key: 2025, count: 60 },
        ],
      });
    }
    return jsonResponse(url.searchParams.get("cursor") === "*" ? pageOne : pageTwo);
  }
  if (url.hostname === "export.arxiv.org") {
    return new Response(arxivXml, { headers: { "content-type": "application/atom+xml" } });
  }
  const callSource = OFFICIAL_CALL_SOURCES.find((source) => new URL(source.url).hostname === url.hostname);
  if (callSource) {
    return new Response(callFixtures[callSource.key], { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  throw new Error(`Unexpected release fixture URL: ${url}`);
}

test("runs the complete release ingestion sequence against stored source fixtures", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const now = () => "2026-08-31T10:00:00.000Z";
  const discoveryRuns = [];

  for (const scope of ["ai", "field"]) {
    for (const layer of ["core", "broad", "frontier"]) {
      discoveryRuns.push(await runIngestion(db, { layer, scope, safetyLimit: 100 }, {
        fetchImpl: releaseFixtureFetch,
        sleep: async () => {},
        now,
        crossrefLimit: 0,
      }));
    }
  }
  const callsRun = await runCallsIngestion(db, { dataset: "calls" }, {
    fetchImpl: releaseFixtureFetch,
    sleep: async () => {},
    now,
  });
  const trendRun = await runIngestion(db, { dataset: "trends", scope: "all" }, {
    fetchImpl: releaseFixtureFetch,
    sleep: async () => {},
    now,
  });

  assert.ok(discoveryRuns.every((run) => run.status === "succeeded"));
  assert.ok(discoveryRuns.every((run) => run.limitReached === false));
  // Six OpenAlex runs follow both stored cursor pages; the two frontier scopes
  // each add one complete arXiv page.
  assert.equal(discoveryRuns.reduce((sum, run) => sum + run.pageCount, 0), 14);
  assert.equal(callsRun.status, "succeeded");
  assert.equal(callsRun.sources.length, OFFICIAL_CALL_SOURCES.length);
  assert.equal(callsRun.requiresManualReview, false);
  assert.equal(trendRun.status, "succeeded");
  assert.equal(trendRun.pageCount, 4);

  assert.equal(db.raw.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.raw.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM ingestion_runs").get().count, 9);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM call_ingestion_runs").get().count, 4);
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS count FROM trend_snapshots").get().count > 0);
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS count FROM theme_signal_snapshots").get().count > 0);

  const discoveryCoverage = db.raw.prepare(`
    SELECT wd.search_layer, ir.scope, COUNT(DISTINCT wd.query_version) AS query_versions
    FROM work_discoveries wd
    JOIN ingestion_runs ir ON ir.id = wd.ingestion_run_id
    GROUP BY wd.search_layer, ir.scope
    ORDER BY ir.scope, wd.search_layer
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(discoveryCoverage, [
    { search_layer: "broad", scope: "ai", query_versions: 1 },
    { search_layer: "core", scope: "ai", query_versions: 1 },
    { search_layer: "frontier", scope: "ai", query_versions: 1 },
    { search_layer: "broad", scope: "field", query_versions: 1 },
    { search_layer: "core", scope: "field", query_versions: 1 },
    { search_layer: "frontier", scope: "field", query_versions: 1 },
  ]);
  assert.ok(db.raw.prepare("SELECT status FROM source_health").all().every((row) => row.status === "healthy"));

  const dashboard = await readRadarData(db, { days: 3650, scope: "ai" });
  assert.equal(dashboard.storage.state, "ready");
  assert.equal(dashboard.dataStatus.publications.status, "live");
  assert.equal(dashboard.dataStatus.preprints.status, "live");
  assert.equal(dashboard.dataStatus.calls.status, "live");
  assert.equal(dashboard.counts.totalFoundComplete, true);
  assert.ok(dashboard.counts.analyzed > 0);
  assert.ok(dashboard.calls.calls.length > 0);
  assert.ok(dashboard.analysisVersion);
  assert.ok(dashboard.queryVersion);
  assert.ok(dashboard.methodology.methodologyVersion);
});
