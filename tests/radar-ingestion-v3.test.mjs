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

const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const { paginateOpenAlex, buildWorksUrl, normalizeOpenAlexWork } = await vite.ssrLoadModule("/lib/radar/openalex.ts");
const { buildArxivUrl, parseArxivFeed } = await vite.ssrLoadModule("/lib/radar/arxiv.ts");
const { runIngestion } = await vite.ssrLoadModule("/lib/radar/ingestion.ts");
const { cautiousTitleSimilarity } = await vite.ssrLoadModule("/lib/radar/repository.ts");

after(async () => {
  await vite.close();
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("follows stored OpenAlex cursor pages without a fixed 75-record cap", async () => {
  const cursors = [];
  const result = await paginateOpenAlex(buildWorksUrl("broad", 90, "ai"), 5_000, {
    fetchImpl: async (input) => {
      const cursor = new URL(String(input)).searchParams.get("cursor");
      cursors.push(cursor);
      return jsonResponse(cursor === "*" ? pageOne : pageTwo);
    },
    sleep: async () => {},
  });

  assert.deepEqual(cursors, ["*", "cursor-page-2"]);
  assert.equal(result.pageCount, 2);
  assert.equal(result.foundCount, 3);
  assert.equal(result.records.length, 3);
  assert.equal(result.limitReached, false);
  assert.equal(buildWorksUrl("broad", 90, "ai").searchParams.get("per_page"), "100");
});

test("parses stored arXiv Atom fixtures and builds a bounded paged query", () => {
  const parsed = parseArxivFeed(arxivXml, "2026-08-28T10:00:00.000Z");
  assert.equal(parsed.totalResults, 1);
  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0].authors.map((author) => author.name), ["Anna Mueller", "Sam Lee"]);
  assert.equal(parsed.entries[0].sourceRecordId, "arxiv:2608.12345");
  assert.equal(parsed.entries[0].doiNormalized, "10.5555/arxiv.fixture");
  assert.equal(parsed.entries[0].publicationDate, "2026-08-20");
  assert.equal(parsed.entries[0].retrievedAt, "2026-08-28T10:00:00.000Z");
  assert.deepEqual(parsed.entries[0].topics, ["cs.HC", "cs.AI"]);

  const url = buildArxivUrl(90, "ai", 100, 100);
  assert.equal(url.searchParams.get("start"), "100");
  assert.equal(url.searchParams.get("max_results"), "100");
  assert.match(url.searchParams.get("search_query"), /large language model/i);
});

test("uses cautious similarity only with title, date and author safeguards", () => {
  const input = {
    ...normalizeOpenAlexWork(pageOne.results[0], "2026-08-28T10:00:00.000Z"),
    doi: null,
    doiNormalized: null,
    title: "How human oversight of artificial intelligence decision support systems shapes cognitive engagement trust reliance and meaningful work in complex organizations",
  };
  const candidate = {
    id: "existing",
    doi_normalized: null,
    title: "How human oversight of artificial intelligence decision support systems shapes cognitive engagement trust reliance and meaningful work in complex workplaces",
    authors_json: JSON.stringify([{ name: "Anna Mueller" }]),
    publication_date: "2026-08-19",
    version_type: "preprint",
  };
  assert.ok(cautiousTitleSimilarity(input, candidate) >= 0.9);
  assert.equal(cautiousTitleSimilarity(input, { ...candidate, authors_json: JSON.stringify([{ name: "Different Author" }]) }), 0);
  assert.equal(cautiousTitleSimilarity(input, { ...candidate, publication_date: "2021-08-19" }), 0);
});

test("stores exact layer and query version while reporting an arXiv source failure separately", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  let firstOpenAlexAttempt = true;
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "export.arxiv.org") return new Response("unavailable", { status: 503 });
    if (url.hostname === "api.openalex.org") {
      if (firstOpenAlexAttempt) {
        firstOpenAlexAttempt = false;
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      }
      return jsonResponse(url.searchParams.get("cursor") === "*" ? pageOne : pageTwo);
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };

  const result = await runIngestion(db, { layer: "frontier", scope: "ai", safetyLimit: 50 }, {
    fetchImpl,
    sleep: async () => {},
    now: () => "2026-08-28T10:00:00.000Z",
    crossrefLimit: 0,
  });

  assert.equal(result.status, "partial");
  assert.equal(result.runIds.length, 2);
  assert.equal(result.sourceStatuses.find((source) => source.provider === "openalex")?.status, "healthy");
  assert.equal(result.sourceStatuses.find((source) => source.provider === "openalex")?.attempts, 3);
  assert.equal(result.sourceStatuses.find((source) => source.provider === "arxiv")?.status, "unavailable");
  assert.equal(result.sourceStatuses.find((source) => source.provider === "arxiv")?.attempts, 3);

  const discoveries = db.raw.prepare("SELECT provider, search_layer, query_version FROM work_discoveries ORDER BY id").all();
  assert.ok(discoveries.length >= 3);
  assert.ok(discoveries.every((row) => row.provider === "openalex"));
  assert.ok(discoveries.every((row) => row.search_layer === "frontier"));
  assert.ok(discoveries.every((row) => row.query_version === "openalex-arxiv-frontier-3.0.0"));
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM works").get().count, 2);

  const health = db.raw.prepare(`
    SELECT s.key, h.status FROM source_health h
    JOIN sources s ON s.id = h.source_id
    ORDER BY s.key
  `).all();
  assert.deepEqual(health.map((row) => ({ ...row })), [
    { key: "arxiv-frontier", status: "unavailable" },
    { key: "openalex-frontier", status: "healthy" },
  ]);
});

test("marks a cursor run partial when the configured safety limit is reached", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const result = await runIngestion(db, { layer: "core", scope: "ai", safetyLimit: 1 }, {
    fetchImpl: async () => jsonResponse(pageOne),
    sleep: async () => {},
    now: () => "2026-08-28T10:00:00.000Z",
    crossrefLimit: 0,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.limitReached, true);
  assert.equal(result.loadedCount, 1);
  assert.equal(db.raw.prepare("SELECT safety_limit, limit_reached FROM ingestion_runs").get().safety_limit, 1);
  assert.equal(db.raw.prepare("SELECT safety_limit, limit_reached FROM ingestion_runs").get().limit_reached, 1);
});
