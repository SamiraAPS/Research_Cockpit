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
const {
  addUserShortlistItem,
  readUserShortlist,
  removeUserShortlistItem,
  searchCorpus,
} = await vite.ssrLoadModule("/lib/radar/corpus-repository.ts");
const { worksToBibtex, worksToCsv } = await vite.ssrLoadModule("/lib/radar/export.ts");

after(async () => {
  await vite.close();
});

function response(records) {
  return new Response(JSON.stringify({ meta: { count: records.length, next_cursor: null }, results: records }), {
    headers: { "content-type": "application/json" },
  });
}

function work(index, overrides = {}) {
  const title = overrides.display_name ?? `Human AI work design study ${index}`;
  return {
    id: `https://openalex.org/W-WORKFLOW-${index}`,
    doi: `https://doi.org/10.5555/workflow.${index}`,
    display_name: title,
    publication_date: `2026-08-${20 + index}`,
    type: "article",
    cited_by_count: index * 10,
    abstract_inverted_index: { Human: [0], AI: [1], work: [2], design: [3], trust: [4] },
    authorships: [{ author_position: "first", author: { id: `A${index}`, display_name: `Researcher ${index}` } }],
    primary_location: {
      landing_page_url: `https://example.org/work/${index}`,
      source: { id: `https://openalex.org/S-WORKFLOW-${index}`, display_name: overrides.source ?? "Human Factors" },
    },
    best_oa_location: { landing_page_url: `https://example.org/work/${index}` },
    open_access: { is_oa: true, oa_status: "gold" },
    topics: [{ display_name: overrides.topic ?? "Work Design" }],
    keywords: [{ display_name: "trust" }],
    ...overrides,
  };
}

async function seededDatabase(context) {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const records = [
    work(1, { display_name: "Trust in human AI work design", cited_by_count: 2 }),
    work(2, { display_name: "Cognitive load in intelligent automation", cited_by_count: 40, topic: "Cognitive Ergonomics", source: "Ergonomics" }),
    work(3, { display_name: "Agency and meaningful work with AI", cited_by_count: 12, topic: "Work Design", source: "Human Relations" }),
  ];
  await runIngestion(db, { dataset: "publications", scope: "ai" }, {
    fetchImpl: async () => response(records),
    now: () => "2026-08-28T10:00:00.000Z",
  });
  return db;
}

test("paginates and searches the complete stored corpus on the server", async (context) => {
  const db = await seededDatabase(context);
  const firstPage = await searchCorpus(db, { scope: "ai", page: 1, pageSize: 2, sort: "date" });
  const secondPage = await searchCorpus(db, { scope: "ai", page: 2, pageSize: 2, sort: "date" });

  assert.deepEqual(firstPage.pagination, { page: 1, pageSize: 2, total: 3, totalPages: 2 });
  assert.equal(firstPage.items.length, 2);
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);

  const search = await searchCorpus(db, { scope: "ai", query: "cognitive load", pageSize: 20 });
  assert.equal(search.pagination.total, 1);
  assert.equal(search.items[0].source, "Ergonomics");
  assert.equal(search.items[0].doi, "10.5555/workflow.2");
  assert.match(search.items[0].abstract, /Human AI work design trust/);
  assert.equal(search.items[0].dataStatus, "live");
});

test("applies stored-metadata filters and all documented sort modes", async (context) => {
  const db = await seededDatabase(context);
  const byDomain = await searchCorpus(db, { scope: "ai", workDomain: "Cognitive Ergonomics", pageSize: 20 });
  assert.deepEqual(byDomain.items.map((item) => item.title), ["Cognitive load in intelligent automation"]);

  const byTheme = await searchCorpus(db, { scope: "ai", theme: "cognition", pageSize: 20 });
  assert.deepEqual(byTheme.items.map((item) => item.title), ["Cognitive load in intelligent automation"]);

  const citations = await searchCorpus(db, { scope: "ai", sort: "citations", pageSize: 20 });
  assert.deepEqual(citations.items.map((item) => item.citedBy), [40, 12, 2]);
  const relevance = await searchCorpus(db, { scope: "ai", sort: "relevance", pageSize: 20 });
  assert.ok(relevance.items[0].relevanceScore >= relevance.items.at(-1).relevanceScore);
  assert.ok(citations.facets.venues.some((facet) => facet.label === "Human Factors" && facet.kind === "journal"));
  assert.ok(citations.facets.workDomains.some((facet) => facet.value === "Work Design"));
  assert.equal(citations.facets.studyTypeDataAvailable, false);
});

test("derives new-since-run and weekly shortlist views from persisted run timestamps", async (context) => {
  const db = await seededDatabase(context);
  const newItems = await searchCorpus(db, { scope: "ai", mode: "new", pageSize: 20 });
  assert.equal(newItems.pagination.total, 3);
  assert.equal(newItems.latestSuccessfulRun.endedAt, "2026-08-28T10:00:00.000Z");
  assert.equal(newItems.latestSuccessfulRun.newCount, 3);

  const weekly = await searchCorpus(db, { scope: "ai", mode: "weekly", pageSize: 20 });
  assert.equal(weekly.pagination.total, 3);
  assert.equal(weekly.weeklyWindow.startAt, "2026-08-24T00:00:00.000Z");
  assert.equal(weekly.weeklyWindow.endAt, "2026-08-30T23:59:59.999Z");
  assert.ok(weekly.items[0].relevanceScore >= weekly.items.at(-1).relevanceScore);
});

test("keeps authenticated shortlists isolated per user", async (context) => {
  const db = await seededDatabase(context);
  const result = await searchCorpus(db, { scope: "ai", pageSize: 20 });
  const workId = result.items[0].id;

  assert.equal(await addUserShortlistItem(db, "user-a", workId, "2026-08-28T11:00:00.000Z"), true);
  assert.deepEqual((await readUserShortlist(db, "user-a")).map((row) => row.work_id), [workId]);
  assert.deepEqual(await readUserShortlist(db, "user-b"), []);
  await removeUserShortlistItem(db, "user-a", workId);
  assert.deepEqual(await readUserShortlist(db, "user-a"), []);
  assert.equal(await addUserShortlistItem(db, "user-a", "missing-work"), false);
});

test("uses the workflow indexes for shortlist and first-seen lookups", async (context) => {
  const db = await seededDatabase(context);
  const shortlistPlan = db.raw.prepare(
    "EXPLAIN QUERY PLAN SELECT work_id FROM user_shortlist_items WHERE user_id = ? ORDER BY created_at DESC",
  ).all("user-a").map((row) => row.detail).join(" ");
  const newWorksPlan = db.raw.prepare(
    "EXPLAIN QUERY PLAN SELECT id FROM works WHERE first_seen_at >= ? AND first_seen_at <= ? ORDER BY first_seen_at DESC",
  ).all("2026-08-01", "2026-08-31").map((row) => row.detail).join(" ");

  assert.match(shortlistPlan, /idx_user_shortlist_user_created/);
  assert.match(newWorksPlan, /idx_works_first_seen/);
});

test("exports stored publication metadata as escaped CSV and BibTeX", async (context) => {
  const db = await seededDatabase(context);
  const result = await searchCorpus(db, { scope: "ai", pageSize: 20, includeFacets: false });
  const csv = worksToCsv(result.items);
  const bibtex = worksToBibtex(result.items);

  assert.match(csv, /^\uFEFF"id","title"/);
  assert.match(csv, /"10\.5555\/workflow\.2"/);
  assert.match(csv, /"abstract"/);
  assert.match(bibtex, /@article\{/);
  assert.match(bibtex, /doi = \{10\.5555\/workflow\.2\}/);
  assert.match(bibtex, /author = \{Researcher 2\}/);
});
