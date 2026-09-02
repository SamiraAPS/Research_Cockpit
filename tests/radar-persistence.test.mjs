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
const { runIngestion } = await vite.ssrLoadModule("/lib/radar/ingestion.ts");
const { createIngestionRun, ensureIngestionSource, persistWork, readRadarData } = await vite.ssrLoadModule("/lib/radar/repository.ts");

after(async () => {
  await vite.close();
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openAlexWork(overrides = {}) {
  return {
    id: "https://openalex.org/W1",
    doi: "https://doi.org/10.1000/radar.1",
    display_name: "Trust in human-AI collaboration",
    publication_date: "2026-08-20",
    type: "article",
    cited_by_count: 4,
    abstract_inverted_index: {
      Human: [0], AI: [1], collaboration: [2], improves: [3], trust: [4],
    },
    authorships: [{
      author_position: "first",
      author: { id: "https://openalex.org/A1", display_name: "Test Author", orcid: "https://orcid.org/0000-0000-0000-0001" },
    }],
    primary_location: {
      landing_page_url: "https://example.org/work",
      source: { id: "https://openalex.org/S83386566", display_name: "Human Factors" },
    },
    best_oa_location: { landing_page_url: "https://example.org/open" },
    open_access: { is_oa: true, oa_status: "gold" },
    topics: [{ display_name: "Human-AI collaboration" }],
    keywords: [{ display_name: "trust" }],
    ...overrides,
  };
}

function worksFetch(records, count = records.length) {
  return async () => jsonResponse({ meta: { count }, results: records });
}

function iso(value) {
  return () => value;
}

function ingestibleWork(overrides = {}) {
  return {
    provider: "openalex",
    doi: "https://doi.org/10.1000/identity",
    doiNormalized: "10.1000/identity",
    openAlexId: "https://openalex.org/W-IDENTITY",
    sourceRecordId: "record-identity",
    normalizedTitle: "identity test",
    title: "Identity test",
    abstract: null,
    authors: [],
    sourceExternalId: "S-IDENTITY",
    sourceName: "Identity Journal",
    sourceKind: "journal",
    sourceType: "journal",
    publicationDate: "2026-08-20",
    onlineDate: null,
    url: "https://example.org/identity",
    isOpenAccess: false,
    openAccessStatus: "closed",
    citedByCount: 0,
    topics: [],
    keywords: [],
    themes: [],
    retrievedAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

test("stores complete work metadata and successful ingestion counters", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const result = await runIngestion(db, { dataset: "publications", scope: "ai" }, {
    fetchImpl: worksFetch([openAlexWork()], 8),
    now: iso("2026-08-28T10:00:00.000Z"),
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    { found: result.foundCount, loaded: result.loadedCount, fresh: result.newCount, updated: result.updatedCount, errors: result.errorCount },
    { found: 8, loaded: 1, fresh: 1, updated: 0, errors: 0 },
  );
  const version = db.raw.prepare(`
    SELECT title, abstract, authors_json, doi, source_name, publication_date, online_date,
      version_type, url, is_open_access, open_access_status, topics_json, keywords_json, retrieved_at
    FROM work_versions
  `).get();
  assert.equal(version.title, "Trust in human-AI collaboration");
  assert.equal(version.abstract, "Human AI collaboration improves trust");
  assert.equal(JSON.parse(version.authors_json)[0].name, "Test Author");
  assert.equal(version.doi, "https://doi.org/10.1000/radar.1");
  assert.equal(version.source_name, "Human Factors");
  assert.equal(version.publication_date, "2026-08-20");
  assert.equal(version.online_date, null);
  assert.equal(version.version_type, "journal");
  assert.equal(version.url, "https://doi.org/10.1000/radar.1");
  assert.equal(version.is_open_access, 1);
  assert.equal(version.open_access_status, "gold");
  assert.deepEqual(JSON.parse(version.topics_json), ["Human-AI collaboration"]);
  assert.deepEqual(JSON.parse(version.keywords_json), ["trust"]);
  assert.equal(version.retrieved_at, "2026-08-28T10:00:00.000Z");
  const run = db.raw.prepare("SELECT * FROM ingestion_runs").get();
  assert.equal(run.status, "succeeded");
  assert.equal(run.started_at, "2026-08-28T10:00:00.000Z");
  assert.equal(run.ended_at, "2026-08-28T10:00:00.000Z");
  assert.equal(run.query_version, "openalex-core-3.0.0");
});

test("creates a new immutable work version when stored metadata changes", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  await runIngestion(db, { dataset: "publications", scope: "ai" }, {
    fetchImpl: worksFetch([openAlexWork()]),
    now: iso("2026-08-28T10:00:00.000Z"),
  });
  const updated = await runIngestion(db, { dataset: "publications", scope: "ai" }, {
    fetchImpl: worksFetch([openAlexWork({ display_name: "Calibrated trust in human-AI collaboration", cited_by_count: 7 })]),
    now: iso("2026-08-29T10:00:00.000Z"),
  });

  assert.equal(updated.newCount, 0);
  assert.equal(updated.updatedCount, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM works").get().count, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM work_versions").get().count, 2);
  const versions = db.raw
    .prepare("SELECT title, is_current FROM work_versions ORDER BY created_at")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(versions, [
    { title: "Trust in human-AI collaboration", is_current: 0 },
    { title: "Calibrated trust in human-AI collaboration", is_current: 1 },
  ]);
});

test("deduplicates a preprint and journal by normalized title while preserving both manifestations", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  await runIngestion(db, { dataset: "preprints", scope: "ai" }, {
    fetchImpl: worksFetch([openAlexWork({
      id: "https://openalex.org/W-PRE",
      doi: "https://doi.org/10.1000/preprint",
      type: "preprint",
      primary_location: { landing_page_url: "https://arxiv.org/abs/1", source: { id: "https://openalex.org/S4306400194", display_name: "arXiv" } },
    })]),
    now: iso("2026-08-28T10:00:00.000Z"),
  });
  await runIngestion(db, { dataset: "publications", scope: "ai" }, {
    fetchImpl: worksFetch([openAlexWork({
      id: "https://openalex.org/W-JOURNAL",
      doi: "https://doi.org/10.1000/journal",
      type: "article",
    })]),
    now: iso("2026-08-29T10:00:00.000Z"),
  });

  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM works").get().count, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM work_sources").get().count, 2);
  const manifestations = db.raw
    .prepare("SELECT version_type, is_current FROM work_versions ORDER BY version_type")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(manifestations, [
    { version_type: "journal", is_current: 1 },
    { version_type: "preprint", is_current: 1 },
  ]);
});

test("deduplicates by DOI, OpenAlex ID and source-record identity", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const sourceId = await ensureIngestionSource(db, "publications", "2026-08-28T10:00:00.000Z");
  const run = await createIngestionRun(db, {
    sourceId,
    scope: "ai",
    queryVersion: "openalex-core-3.0.0",
    startedAt: "2026-08-28T10:00:00.000Z",
  });
  const contextInput = { ingestionRunId: run.id, scope: "ai", searchLayer: "core", queryVersion: "openalex-core-3.0.0" };

  await persistWork(db, ingestibleWork(), contextInput);
  await persistWork(db, ingestibleWork({
    openAlexId: "https://openalex.org/W-DOI",
    sourceRecordId: "record-doi",
    normalizedTitle: "different title for doi match",
    title: "Different title for DOI match",
  }), contextInput);
  await persistWork(db, ingestibleWork({
    doi: null,
    doiNormalized: null,
    sourceRecordId: "record-openalex",
    normalizedTitle: "different title for openalex match",
    title: "Different title for OpenAlex match",
  }), contextInput);
  await persistWork(db, ingestibleWork({
    doi: null,
    doiNormalized: null,
    openAlexId: "https://openalex.org/W-SOURCE-RECORD",
    normalizedTitle: "different title for source record match",
    title: "Different title for source-record match",
  }), contextInput);

  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM works").get().count, 1);
});

test("persists a failed ingestion run and source-health event", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const result = await runIngestion(db, { dataset: "preprints", scope: "field" }, {
    fetchImpl: async () => { throw new Error("OpenAlex offline"); },
    now: iso("2026-08-28T11:00:00.000Z"),
  });

  assert.equal(result.status, "failed");
  const run = db.raw.prepare("SELECT status, ended_at, loaded_count, new_count, updated_count, error_count, error_message FROM ingestion_runs").get();
  assert.equal(run.status, "failed");
  assert.equal(run.ended_at, "2026-08-28T11:00:00.000Z");
  assert.equal(run.loaded_count, 0);
  assert.equal(run.new_count, 0);
  assert.equal(run.updated_count, 0);
  assert.equal(run.error_count, 1);
  assert.match(run.error_message, /OpenAlex offline/);
  const health = db.raw.prepare("SELECT status, error_message FROM source_health").get();
  assert.equal(health.status, "unavailable");
  assert.match(health.error_message, /OpenAlex offline/);
});

test("appends historical trend snapshots instead of overwriting them", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  let generation = 0;
  const fetchImpl = async (input) => {
    const filter = new URL(String(input)).searchParams.get("filter") ?? "";
    const preprint = filter.includes("type:preprint");
    const count = generation === 0 ? (preprint ? 2 : 10) : (preprint ? 3 : 15);
    return jsonResponse({ meta: { count }, group_by: [{ key: 2025, count }] });
  };
  const firstRun = await runIngestion(db, { dataset: "trends" }, { fetchImpl, now: iso("2026-08-28T12:00:00.000Z") });
  generation = 1;
  const secondRun = await runIngestion(db, { dataset: "trends" }, { fetchImpl, now: iso("2026-08-29T12:00:00.000Z") });

  assert.notEqual(firstRun.runId, secondRun.runId);
  const snapshots = db.raw.prepare("SELECT ingestion_run_id, scope, publication_type, record_count FROM trend_snapshots ORDER BY captured_at, scope, publication_type").all();
  assert.equal(snapshots.length, 8);
  assert.deepEqual(snapshots.map((row) => row.record_count), [10, 2, 10, 2, 15, 3, 15, 3]);

  const signalSnapshots = db.raw.prepare("SELECT ingestion_run_id, scope, theme, snapshot_json FROM theme_signal_snapshots ORDER BY captured_at, scope, theme").all();
  assert.equal(signalSnapshots.length, 32);
  assert.equal(new Set(signalSnapshots.map((row) => row.ingestion_run_id)).size, 2);
  assert.deepEqual(new Set(signalSnapshots.map((row) => row.scope)), new Set(["ai", "field"]));
  const storedSignal = JSON.parse(signalSnapshots[0].snapshot_json);
  assert.equal(storedSignal.snapshotVersion, "theme-signal-snapshot-1.0.0");
  assert.equal(storedSignal.opportunity.score, null);

  const payload = await readRadarData(db, { days: 90, scope: "ai" });
  assert.equal(payload.trendAnalysis.snapshotAt, "2026-08-29T12:00:00.000Z");
  assert.equal(payload.trendAnalysis.themes.length, 8);
  assert.equal(payload.trendAnalysis.themes[0].dataQuality.status, "unavailable");
});

test("returns an honest initialization state for an empty migrated database", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const payload = await readRadarData(db, { days: 90, scope: "ai" });

  assert.equal(payload.storage.state, "empty");
  assert.equal(payload.status, "unavailable");
  assert.deepEqual(payload.works, []);
  assert.deepEqual(payload.trend, []);
  assert.equal(payload.trendAnalysis.status.status, "unavailable");
  assert.deepEqual(payload.trendAnalysis.themes, []);
  assert.equal(payload.counts.analyzed, 0);
  assert.match(payload.dataStatus.publications.error, /Noch kein Ingestion-Lauf/);
});
