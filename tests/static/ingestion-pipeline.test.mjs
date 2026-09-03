import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ingestArxiv, parseArxivFeed } from "../../scripts/ingestion/arxiv.mjs";
import { CORE_CONFERENCES } from "../../scripts/ingestion/config.mjs";
import { deduplicateRecords } from "../../scripts/ingestion/deduplicate.mjs";
import { fetchWithRetry, SourceRequestError } from "../../scripts/ingestion/http.mjs";
import { buildOpenAlexUrl, ingestOpenAlex } from "../../scripts/ingestion/openalex.mjs";
import { runStaticIngestion } from "../../scripts/ingestion/pipeline.mjs";
import { validateDataDirectory } from "../../scripts/validate-data.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const fixtureDirectory = path.join(projectRoot, "tests/fixtures");
const validStaticFixture = path.join(fixtureDirectory, "static-data/valid");
const fixedNow = new Date("2026-09-01T12:00:00Z");

async function fixture(name) {
  return readFile(path.join(fixtureDirectory, name), "utf8");
}

const [openAlexPageOne, openAlexPageTwo, arxivXml] = await Promise.all([
  fixture("openalex-page-1.json").then(JSON.parse),
  fixture("openalex-page-2.json").then(JSON.parse),
  fixture("arxiv-feed.xml")
]);

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("Core-, Broad- und Frontier-Konfiguration enthält die geforderten Konferenzen", () => {
  const labels = CORE_CONFERENCES.map((source) => `${source.name} ${source.area}`).join(" ");
  for (const expected of ["CHI", "CSCW/PACMHCI", "IUI", "HRI", "DIS", "HFES"]) assert.match(labels, new RegExp(expected.replace("/", "\\/"), "i"));

  const core = buildOpenAlexUrl("core", { days: 7, now: fixedNow });
  const broad = buildOpenAlexUrl("broad", { days: 7, now: fixedNow });
  const frontier = buildOpenAlexUrl("frontier", { days: 7, now: fixedNow });
  assert.equal(core.url.searchParams.get("per_page"), "100");
  assert.equal(core.url.searchParams.get("cursor"), "*");
  assert.match(core.url.searchParams.get("filter"), /S4363607743/);
  assert.doesNotMatch(broad.url.searchParams.get("filter"), /primary_location\.source\.id/);
  assert.match(frontier.url.searchParams.get("filter"), /S4306400194/);
});

test("OpenAlex folgt jedem Cursor bis next_cursor null ohne Ergebnislimit", async () => {
  const cursors = [];
  const result = await ingestOpenAlex("core", {
    days: 7,
    now: fixedNow,
    fetchImpl: async (input) => {
      const cursor = new URL(String(input)).searchParams.get("cursor");
      cursors.push(cursor);
      return jsonResponse(cursor === "*" ? openAlexPageOne : openAlexPageTwo);
    },
    sleep: async () => {}
  });
  assert.deepEqual(cursors, ["*", "cursor-page-2"]);
  assert.equal(result.stats.pageCount, 2);
  assert.equal(result.stats.foundCount, 3);
  assert.equal(result.records.length, 3);
});

test("arXiv wird direkt als Atom-Feed vollständig über start paginiert", async () => {
  const parsed = parseArxivFeed(arxivXml, { retrievedAt: fixedNow.toISOString() });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].sourceRecordId, "2608.12345");
  assert.equal(parsed.records[0].doi, "10.5555/arxiv.fixture");

  const starts = [];
  const threeResultFeed = arxivXml.replace("<opensearch:totalResults>1</opensearch:totalResults>", "<opensearch:totalResults>3</opensearch:totalResults>");
  const result = await ingestArxiv({
    days: 7,
    now: fixedNow,
    fetchImpl: async (input) => {
      starts.push(Number(new URL(String(input)).searchParams.get("start")));
      return new Response(threeResultFeed, { status: 200, headers: { "content-type": "application/atom+xml" } });
    },
    sleep: async () => {}
  });
  assert.deepEqual(starts, [0, 1, 2]);
  assert.equal(result.stats.pageCount, 3);
  assert.equal(result.records.length, 3);
});

test("HTTP-Schicht behandelt 429, Backoff und wiederholte Timeout-Fehler", async () => {
  const sleeps = [];
  let attempt = 0;
  const result = await fetchWithRetry("https://api.openalex.org/works", {
    source: "OpenAlex",
    fetchImpl: async () => {
      attempt += 1;
      return attempt === 1
        ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
        : jsonResponse({ results: [] });
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.rateLimitEvents, 1);
  assert.deepEqual(sleeps, [0]);

  await assert.rejects(() => fetchWithRetry("https://export.arxiv.org/api/query", {
    source: "arXiv",
    maxAttempts: 2,
    fetchImpl: async () => { throw new DOMException("Timeout", "AbortError"); },
    sleep: async () => {}
  }), (error) => error instanceof SourceRequestError && error.attempts === 2);
});

test("DOI-, externe ID- und Titeldeduplizierung verknüpft Preprint und Journalversion", async () => {
  const openAlex = await ingestOpenAlex("core", {
    days: 7,
    now: fixedNow,
    fetchImpl: async (input) => jsonResponse(new URL(String(input)).searchParams.get("cursor") === "*" ? openAlexPageOne : openAlexPageTwo),
    sleep: async () => {}
  });
  const titleDuplicate = {
    ...structuredClone(openAlex.records[1]),
    provider: "arxiv",
    sourceRecordId: "title-only-duplicate",
    externalIds: { arxiv: "title-only-duplicate" },
    sourceType: "preprint",
    publicationDate: "2026-08-19"
  };
  const result = deduplicateRecords([...openAlex.records, titleDuplicate], { generatedAt: fixedNow.toISOString(), failedProviders: new Set() });
  assert.equal(result.works.length, 2);
  assert.equal(result.stats.doi, 1);
  assert.equal(result.stats.title, 1);
  assert.equal(result.stats.versionLinks, 2);
  const linked = result.works.find((work) => work.doi === "10.5555/radar.fixture.1");
  assert.ok(linked.versions.some((version) => version.type === "journal"));
  assert.ok(linked.versions.some((version) => version.type === "preprint"));
});

function successfulFixtureFetch(log) {
  return async (input) => {
    const url = new URL(String(input));
    log.push({ host: url.hostname, path: url.pathname, cursor: url.searchParams.get("cursor"), start: url.searchParams.get("start") });
    if (url.hostname === "api.openalex.org") return jsonResponse(url.searchParams.get("cursor") === "*" ? openAlexPageOne : openAlexPageTwo);
    if (url.hostname === "export.arxiv.org") return new Response(arxivXml, { status: 200, headers: { "content-type": "application/atom+xml" } });
    if (url.hostname === "api.crossref.org") return jsonResponse({
      status: "ok",
      message: {
        DOI: decodeURIComponent(url.pathname.split("/").at(-1)),
        abstract: "<jats:p>Crossref fixture abstract.</jats:p>",
        author: [{ given: "Anna", family: "Mueller" }],
        subject: ["Human factors"],
        "published-online": { "date-parts": [[2026, 8, 21]] }
      }
    });
    throw new Error(`Unerwartete Fixture-URL: ${url}`);
  };
}

test("Pipeline schreibt valide statische Dateien und nutzt Crossref nur per DOI-Enrichment", async (t) => {
  const temporaryData = await mkdtemp(path.join(os.tmpdir(), "radar-static-ingestion-"));
  t.after(() => rm(temporaryData, { recursive: true, force: true }));
  await cp(validStaticFixture, temporaryData, { recursive: true });
  const requests = [];
  const report = await runStaticIngestion({
    dataDirectory: temporaryData,
    mode: "all",
    days: 7,
    now: fixedNow,
    fetchImpl: successfulFixtureFetch(requests),
    sleep: async () => {}
  });

  assert.equal(report.status, "ready");
  assert.deepEqual(report.modes, ["core", "broad", "frontier"]);
  assert.equal(report.counts.rawFoundBySources, 10);
  assert.equal(report.output.worksPages, 1);
  const crossrefRequests = requests.filter((request) => request.host === "api.crossref.org");
  assert.ok(crossrefRequests.length > 0);
  assert.ok(crossrefRequests.every((request) => request.path.startsWith("/works/")));
  assert.equal(requests.some((request) => request.host === "api.crossref.org" && request.path === "/works"), false);

  const validation = await validateDataDirectory(temporaryData);
  assert.equal(validation.valid, true, validation.errors.map((error) => JSON.stringify(error)).join("\n"));
  const metadata = JSON.parse(await readFile(path.join(temporaryData, "meta.json"), "utf8"));
  assert.equal(metadata.queryVersion, "static-search-4.0.0");
  assert.equal(metadata.mode, "snapshot");
});

test("Quellenausfall erhält verifizierte Works und markiert Quelle stale sowie Datensatz partial", async (t) => {
  const temporaryData = await mkdtemp(path.join(os.tmpdir(), "radar-static-stale-"));
  t.after(() => rm(temporaryData, { recursive: true, force: true }));
  await cp(validStaticFixture, temporaryData, { recursive: true });
  await runStaticIngestion({
    dataDirectory: temporaryData,
    mode: "all",
    days: 7,
    now: fixedNow,
    fetchImpl: successfulFixtureFetch([]),
    sleep: async () => {}
  });
  const before = JSON.parse(await readFile(path.join(temporaryData, "meta.json"), "utf8"));

  const failed = await runStaticIngestion({
    dataDirectory: temporaryData,
    mode: "frontier",
    days: 7,
    now: new Date("2026-09-02T12:00:00Z"),
    crossref: false,
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
    sleep: async () => {}
  });
  const after = JSON.parse(await readFile(path.join(temporaryData, "meta.json"), "utf8"));
  assert.equal(failed.status, "partial");
  assert.equal(after.totalFound, before.totalFound);
  assert.equal(after.lastSuccessfulIngestionAt, before.lastSuccessfulIngestionAt);
  assert.ok(after.sourceStatus.some((source) => source.status === "stale"));
  const page = JSON.parse(await readFile(path.join(temporaryData, "works/page-001.json"), "utf8"));
  assert.ok(page.items.some((work) => work.dataStatus === "stale"));
  const validation = await validateDataDirectory(temporaryData);
  assert.equal(validation.valid, true, validation.errors.map((error) => JSON.stringify(error)).join("\n"));
});
