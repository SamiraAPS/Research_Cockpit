import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { createTestD1 } from "./helpers/d1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const {
  AI_SEARCH_TERMS,
  HUMAN_WORK_SEARCH_TERMS,
  QUERY_VERSIONS,
  SEARCH_CONFIG_VERSION,
} = await vite.ssrLoadModule("/lib/radar/config/search.v3.ts");
const { METHODOLOGY_MANIFEST } = await vite.ssrLoadModule("/lib/radar/config/methodology.v1.ts");
const { computeRetrievalMetrics, GOLD_STANDARD_RECORDS } = await vite.ssrLoadModule("/lib/radar/config/gold-standard.v1.ts");
const { buildWorksUrl } = await vite.ssrLoadModule("/lib/radar/openalex.ts");
const { buildArxivUrl } = await vite.ssrLoadModule("/lib/radar/arxiv.ts");
const { runIngestion } = await vite.ssrLoadModule("/lib/radar/ingestion.ts");
const { readDataQualityReport } = await vite.ssrLoadModule("/lib/radar/quality.ts");
const { readRadarData } = await vite.ssrLoadModule("/lib/radar/repository.ts");
const { worksToAuditCsv } = await vite.ssrLoadModule("/lib/radar/export.ts");

after(async () => {
  await vite.close();
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function record(index, { abstract = null } = {}) {
  return {
    id: `https://openalex.org/W-QUALITY-${index}`,
    doi: null,
    display_name: `Human oversight and work design quality record ${index}`,
    publication_date: "2026-08-01",
    type: "article",
    cited_by_count: 0,
    abstract_inverted_index: abstract ? { Human: [0], oversight: [1] } : null,
    authorships: [{ author_position: "first", author: { display_name: `Researcher ${index}` } }],
    primary_location: {
      landing_page_url: `https://openalex.org/W-QUALITY-${index}`,
      source: { id: "https://openalex.org/S83386566", display_name: "Human Factors" },
    },
    open_access: { is_oa: false, oa_status: "closed" },
    topics: [{ display_name: "Work Design" }],
    keywords: [],
  };
}

function corpusWork() {
  return {
    id: "work-audit-1",
    title: "Human oversight audit record",
    authors: ["A. Researcher"],
    publicationDate: "2026-08-01",
    source: "Human Factors",
    sourceType: "journal",
    searchLayers: ["core"],
    citedBy: 0,
    url: "https://openalex.org/W-AUDIT-1",
    isOpenAccess: false,
    themes: ["safety"],
    themeClassifications: [],
    why: "Regelbasiertes Signal",
    relevanceScore: 50,
    abstract: "Human oversight in a work system.",
    doi: null,
    onlineDate: null,
    openAccessStatus: "closed",
    topics: ["Work Design"],
    keywords: [],
    retrievedAt: "2026-08-10T10:00:00.000Z",
    firstSeenAt: "2026-08-10T10:00:00.000Z",
    sourceKind: "journal",
    dataStatus: "live",
    ingestionStatus: "succeeded",
    emergingSignal: { rank: 0, status: "insufficient" },
  };
}

test("pins complete search strings to explicit query versions", () => {
  assert.equal(SEARCH_CONFIG_VERSION, "search-3.0.0");
  assert.deepEqual(Object.keys(QUERY_VERSIONS).sort(), ["broad", "core", "frontier", "trends"]);
  assert.ok(Object.values(QUERY_VERSIONS).every((version) => /-\d+\.\d+\.\d+$/.test(version)));
  for (const term of ["large language models", "ChatGPT", "AI agents", "algorithmic management", "cobots"]) {
    assert.ok(AI_SEARCH_TERMS.includes(term));
  }
  for (const term of ["deskilling", "expertise", "cognitive engagement", "human oversight", "meaningful work"]) {
    assert.ok(HUMAN_WORK_SEARCH_TERMS.includes(term));
  }
  const openAlexFilter = buildWorksUrl("core", 90, "ai").searchParams.get("filter");
  assert.match(openAlexFilter, /title_and_abstract\.search/);
  assert.match(openAlexFilter, /large language models/);
  assert.match(openAlexFilter, /meaningful work/);
  assert.match(buildArxivUrl(90, "ai").searchParams.get("search_query"), /cat:cs\.HC/);
  assert.deepEqual(METHODOLOGY_MANIFEST.versions.queryByLayer, QUERY_VERSIONS);
});

test("reports all configured plausibility warnings without mutating records", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const records = [1, 2, 3, 4].map((index) => record(index));
  await runIngestion(db, { layer: "core", scope: "ai" }, {
    fetchImpl: async () => jsonResponse({ meta: { count: 100, next_cursor: null }, results: records }),
    sleep: async () => {},
    now: () => "2026-08-01T10:00:00.000Z",
    crossrefLimit: 0,
  });
  await runIngestion(db, { layer: "core", scope: "ai" }, {
    fetchImpl: async () => jsonResponse({ meta: { count: 40, next_cursor: null }, results: records }),
    sleep: async () => {},
    now: () => "2026-08-10T10:00:00.000Z",
    crossrefLimit: 0,
  });

  const report = await readDataQualityReport(db, "ai", "2026-08-20T10:00:00.000Z");
  const checks = new Set(report.warnings.map((item) => item.check));
  assert.ok(checks.has("source_decline"));
  assert.ok(checks.has("high_duplicate_share"));
  assert.ok(checks.has("missing_abstracts"));
  assert.ok(checks.has("stale_ingestion_run"));
  assert.equal(report.status, "partial");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM works").get().count, 4);
});

test("warns for unexpected zero hits", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  await runIngestion(db, { layer: "broad", scope: "ai" }, {
    fetchImpl: async () => jsonResponse({ meta: { count: 0, next_cursor: null }, results: [] }),
    sleep: async () => {},
    now: () => "2026-08-20T10:00:00.000Z",
    crossrefLimit: 0,
  });
  const report = await readDataQualityReport(db, "ai", "2026-08-20T11:00:00.000Z");
  assert.ok(report.warnings.some((warning) => warning.check === "unexpected_zero_hits" && warning.metric === 0));
});

test("distinguishes partial and complete source outages", async (context) => {
  const partialDb = await createTestD1(root);
  const failedDb = await createTestD1(root);
  context.after(() => partialDb.close());
  context.after(() => failedDb.close());
  await runIngestion(partialDb, { layer: "frontier", scope: "ai", safetyLimit: 20 }, {
    fetchImpl: async (input) => new URL(String(input)).hostname === "api.openalex.org"
      ? jsonResponse({ meta: { count: 1, next_cursor: null }, results: [record(1, { abstract: "available" })] })
      : new Response("arXiv unavailable", { status: 503 }),
    sleep: async () => {},
    now: () => "2026-08-20T10:00:00.000Z",
    crossrefLimit: 0,
  });
  const partial = await readDataQualityReport(partialDb, "ai", "2026-08-20T11:00:00.000Z");
  assert.equal(partial.status, "partial");
  assert.ok(partial.warnings.some((warning) => warning.check === "source_unavailable" && /arXiv/.test(warning.source)));

  await runIngestion(failedDb, { layer: "core", scope: "ai" }, {
    fetchImpl: async () => { throw new Error("OpenAlex unavailable"); },
    sleep: async () => {},
    now: () => "2026-08-20T10:00:00.000Z",
  });
  const failed = await readDataQualityReport(failedDb, "ai", "2026-08-20T11:00:00.000Z");
  assert.equal(failed.status, "unavailable");
  assert.ok(failed.warnings.some((warning) => warning.check === "source_unavailable" && warning.severity === "error"));
});

test("publishes a machine-readable methodology and withholds unlabeled metrics", async (context) => {
  assert.deepEqual(GOLD_STANDARD_RECORDS, []);
  assert.deepEqual(computeRetrievalMetrics([]), {
    status: "not_available",
    manuallyLabeledCount: 0,
    precision: null,
    recall: null,
    reason: "Es liegen noch keine manuell verifizierten Goldstandard-Labels vor.",
  });
  const metrics = computeRetrievalMetrics([
    { id: "1", title: "A", expectedRelevance: "relevant", retrieved: true, reviewStatus: "manually_verified" },
    { id: "2", title: "B", expectedRelevance: "irrelevant", retrieved: true, reviewStatus: "manually_verified" },
    { id: "3", title: "C", expectedRelevance: "relevant", retrieved: false, reviewStatus: "manually_verified" },
  ]);
  assert.equal(metrics.status, "available");
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);

  const db = await createTestD1(root);
  context.after(() => db.close());
  const dashboard = await readRadarData(db, { days: 90, scope: "ai" });
  assert.equal(dashboard.methodology.methodologyVersion, "methodology-1.0.0");
  assert.equal(dashboard.methodology.evaluation.status, "not_available");
  assert.equal(dashboard.methodology.evaluation.precision, null);
  assert.equal(dashboard.methodology.evaluation.recall, null);
  assert.equal(dashboard.quality.status, "unavailable");
});

test("exports only blank manual labels for the audit workflow", () => {
  const csv = worksToAuditCsv([corpusWork()], {
    methodologyVersion: "methodology-1.0.0",
    goldStandardVersion: "gold-standard-1.0.0",
    queryVersion: "search-3.0.0",
  });
  assert.match(csv, /"manual_label","manual_note","review_status"/);
  assert.match(csv, /"","","pending_manual_review"/);
  assert.doesNotMatch(csv, /,"relevant",|,"irrelevant",|,"unclear",/);
});
