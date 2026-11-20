import assert from "node:assert/strict";
import test from "node:test";

import { CITATION_SEARCH, CORE_EXTRA_AI_TERMS } from "../../scripts/ingestion/config.mjs";
import { deduplicateRecords, staticWorkToRecord } from "../../scripts/ingestion/deduplicate.mjs";
import { libraryCitations } from "../../scripts/ingestion/normalize.mjs";
import { buildOpenAlexUrl, ingestOpenAlex } from "../../scripts/ingestion/openalex.mjs";
import { advanceRetrievalState, planDiscoveryRuns } from "../../scripts/ingestion/schedule.mjs";
import { buildLibraryGraph, resolveCitations } from "../../scripts/similarity/graph.mjs";

const libraryIds = new Map([["W10", "10.1/lee"], ["W11", "10.1/parasuraman"], ["W12", "10.1/hackman"]]);
const openAlexWork = (id, references, extra = {}) => ({
  id: `https://openalex.org/${id}`, doi: `https://doi.org/10.9/${id.toLowerCase()}`, display_name: `Work ${id}`, publication_date: "2026-11-10", type: "article",
  cited_by_count: 0, abstract_inverted_index: { Trust: [0], in: [1], automation: [2] }, authorships: [{ author: { id: "https://openalex.org/A1", display_name: "A. Author" } }],
  primary_location: { source: { id: "https://openalex.org/S1", display_name: "Organization Science" }, landing_page_url: "https://example.org/x" },
  open_access: { is_oa: true }, topics: [], keywords: [], referenced_works: references.map(reference => `https://openalex.org/${reference}`), ...extra
});

test("names the library references a work cites", () => {
  assert.deepEqual(libraryCitations(["https://openalex.org/W11", "https://openalex.org/W999", "W10", "https://openalex.org/W11"], libraryIds), ["10.1/lee", "10.1/parasuraman"]);
  assert.deepEqual(libraryCitations(["https://openalex.org/W11"], new Map()), []);
  assert.deepEqual(libraryCitations(undefined, libraryIds), []);
});

test("citation query asks for works citing the given references, without search terms or venue filter", () => {
  const { url, config } = buildOpenAlexUrl("citation", { citedWorkIds: ["W10", "W11", "not-an-id"], range: { from: "2026-11-06", to: "2026-11-20" }, conferenceSourceIds: ["S9"] });
  const filter = url.searchParams.get("filter");
  assert.match(filter, /(^|,)cites:W10\|W11$/);
  assert.doesNotMatch(filter, /title_and_abstract|locations\.source/);
  assert.match(url.searchParams.get("select"), /referenced_works/);
  assert.equal(config.queryVersion, "static-openalex-citation-1.0.0:citation");
  assert.throws(() => buildOpenAlexUrl("citation", { citedWorkIds: [] }), /ohne Referenzarbeiten/);
});

test("the wider vocabulary applies to core venues only", () => {
  const terms = mode => buildOpenAlexUrl(mode, { researchArea: "human-ai" }).url.searchParams.get("filter");
  for (const term of ["automation", "decision support", "recommendation tools"]) assert.ok(CORE_EXTRA_AI_TERMS.includes(term));
  assert.match(terms("core"), /"automation" OR|OR "automation"/);
  assert.doesNotMatch(terms("broad"), /OR "automation"|"automation" OR/);
  assert.doesNotMatch(terms("frontier"), /OR "automation"|"automation" OR/);
});

test("citation search keeps works that cite at least two library references", async () => {
  const results = [openAlexWork("W1", ["W10", "W11", "W500"]), openAlexWork("W2", ["W10"]), openAlexWork("W3", ["W700"]), openAlexWork("W4", ["W10", "W11", "W12"])];
  const fetchImpl = async () => new Response(JSON.stringify({ meta: { count: results.length, next_cursor: null }, results }), { status: 200 });
  const { records, stats } = await ingestOpenAlex("citation", { citedWorkIds: ["W10", "W11", "W12"], libraryIds, fetchImpl, range: { from: "2026-11-06", to: "2026-11-20" } });
  assert.equal(CITATION_SEARCH.minCited, 2);
  assert.deepEqual(records.map(record => [record.sourceRecordId, record.libraryCitations]), [["W1", ["10.1/lee", "10.1/parasuraman"]], ["W4", ["10.1/hackman", "10.1/lee", "10.1/parasuraman"]]]);
  assert.equal(records[0].mode, "citation");
  assert.equal(stats.foundCount, 4);

  // Other searches keep everything and still record what is cited.
  const core = await ingestOpenAlex("core", { researchArea: "human-ai", libraryIds, fetchImpl, range: { from: "2026-11-06", to: "2026-11-20" } });
  assert.deepEqual(core.records.map(record => record.libraryCitations.length), [2, 1, 0, 3]);
});

test("cited references survive the rebuild of a work and are replaced by a fresh reference list", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ meta: { count: 1, next_cursor: null }, results: [openAlexWork("W1", ["W10", "W11"])] }), { status: 200 });
  const { records } = await ingestOpenAlex("citation", { citedWorkIds: ["W10"], libraryIds, fetchImpl, range: { from: "2026-11-06", to: "2026-11-20" } });
  const [first] = deduplicateRecords(records, { generatedAt: "2026-11-20T00:00:00.000Z" }).works;
  assert.deepEqual(first.libraryCitations, ["10.1/lee", "10.1/parasuraman"]);
  assert.ok(first.discoveredBy.some(entry => entry.mode === "citation"));

  const [kept] = deduplicateRecords([staticWorkToRecord(first)], { generatedAt: "2026-11-21T00:00:00.000Z" }).works;
  assert.deepEqual(kept.libraryCitations, ["10.1/lee", "10.1/parasuraman"]);

  const refetch = async () => new Response(JSON.stringify({ meta: { count: 1, next_cursor: null }, results: [openAlexWork("W1", ["W12"])] }), { status: 200 });
  const again = await ingestOpenAlex("core", { researchArea: "human-ai", libraryIds, fetchImpl: refetch, range: { from: "2026-11-06", to: "2026-11-20" } });
  const [updated] = deduplicateRecords([...again.records, staticWorkToRecord(first)], { generatedAt: "2026-11-22T00:00:00.000Z" }).works;
  assert.deepEqual(updated.libraryCitations, ["10.1/hackman"]);

  const [plain] = deduplicateRecords((await ingestOpenAlex("core", { researchArea: "human-ai", fetchImpl, range: { from: "2026-11-06", to: "2026-11-20" } })).records, { generatedAt: "2026-11-20T00:00:00.000Z" }).works;
  assert.equal(Object.hasOwn(plain, "libraryCitations"), false);
});

test("plans one fresh and one history stream per batch of references and continues where it stopped", () => {
  const now = new Date("2026-11-20T06:00:00.000Z");
  const batches = [["W10", "W11"], ["W12"]];
  const jobs = planDiscoveryRuns({}, { now, maxPages: 5, citationBatches: batches }, ["core"]).filter(job => job.mode === "citation");
  assert.deepEqual(jobs.map(job => [job.key, job.range.from, job.range.to, job.maxPages, job.citedWorkIds.length]), [
    ["openalex:citation:1:fresh", "2026-11-06", "2026-11-20", 5, 2], ["openalex:citation:1:history", "2019-01-01", "2019-03-31", 6, 2],
    ["openalex:citation:2:fresh", "2026-11-06", "2026-11-20", 5, 1], ["openalex:citation:2:history", "2019-01-01", "2019-03-31", 6, 1]
  ]);
  assert.equal(planDiscoveryRuns({}, { now }, ["core"]).some(job => job.mode === "citation"), false);

  const stats = (status, extra = {}) => ({ provider: "openalex", modes: ["citation"], status, foundCount: 900, recordCount: 40, parameters: { streamKey: "openalex:citation:1:history", lane: "history", researchArea: "library", fromDate: "2019-01-01", toDate: "2019-03-31", ...extra } });
  const partial = advanceRetrievalState(null, [stats("degraded", { nextCursor: "cursor-2" })], now.toISOString());
  const resumed = planDiscoveryRuns({ retrievalState: partial }, { now, citationBatches: batches }, ["core"]).find(job => job.key === "openalex:citation:1:history");
  assert.deepEqual([resumed.range.from, resumed.range.to, resumed.cursor], ["2019-01-01", "2019-03-31", "cursor-2"]);
  const done = advanceRetrievalState(partial, [stats("healthy")], now.toISOString());
  const next = planDiscoveryRuns({ retrievalState: done }, { now, citationBatches: batches }, ["core"]).find(job => job.key === "openalex:citation:1:history");
  assert.deepEqual([next.range.from, next.range.to, next.cursor], ["2019-04-01", "2019-06-29", null]);
});

test("the graph keeps the OpenAlex id of each reference and refetches a graph that lacks them", async () => {
  const seeds = [{ title: "A", doi: "10.1/a", authors: [] }, { title: "B", doi: "10.1/b", authors: [] }];
  const library = { profiles: [{ id: "p", label: "P" }], seeds };
  let calls = 0;
  const fetchRecords = async () => { calls += 1; return { requested: 2, records: [{ id: "https://openalex.org/W1", doi: "10.1/a", referenced_works: [] }, { id: "https://openalex.org/W2", doi: "10.1/b", referenced_works: ["https://openalex.org/W1"] }] }; };
  const now = new Date("2026-11-20T00:00:00.000Z");
  const citations = await resolveCitations(seeds, null, { now, fetchRecords });
  const vectors = [[1, 0], [0, 1]].map(values => Float32Array.from(values));
  const graph = buildLibraryGraph({ library, seedVectors: vectors, seedProfiles: [[0], [0]], citations, model: "stub" });
  assert.deepEqual(graph.nodes.map(node => node.openalex), ["W1", "W2"]);
  const reused = await resolveCitations(seeds, graph, { now, fetchRecords });
  assert.deepEqual([calls, reused.ids], [1, ["W1", "W2"]]);
  const withoutIds = { ...graph, nodes: graph.nodes.map(node => ({ ...node, openalex: null })) };
  await resolveCitations(seeds, withoutIds, { now, fetchRecords });
  assert.equal(calls, 2);
});
