import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CORPUS_LIMIT, limitCorpus, readExcludedScores, retentionReason } from "../../scripts/ingestion/corpus-limit.mjs";
import { rankLibrarySimilarity } from "../../scripts/similarity/rank.mjs";

const work = (id, mode, extra = {}) => ({ id, recordType: "publication", title: `Work ${id}`, abstract: "An abstract.", discoveredBy: [{ provider: "openalex", mode }], pagePath: "./works/page-001.json", ...extra });

test("a work stays for its venue, its citations or its closeness, and goes otherwise", () => {
  const low = CORPUS_LIMIT.minScore - 0.2;
  assert.equal(retentionReason(work("a", "core"), low), "core-venue");
  assert.equal(retentionReason(work("b", "citation"), low), "cites-library");
  assert.equal(retentionReason(work("c", "broad", { libraryCitations: ["10.1/x"] }), low), "cites-library");
  assert.equal(retentionReason(work("d", "broad"), CORPUS_LIMIT.minScore), "close-to-library");
  assert.equal(retentionReason(work("e", "frontier"), low), null);
  // Not ranked yet: kept until it is, unless it was already dropped before.
  assert.equal(retentionReason(work("f", "broad"), null), "awaiting-ranking");
  assert.equal(retentionReason(work("f", "broad"), null, [low, 1]), null);
  // Judged on its title alone back then and has an abstract now: gets a second look.
  assert.equal(retentionReason(work("g", "broad"), null, [low, 0]), "awaiting-ranking");
  assert.equal(retentionReason(work("g", "broad", { abstract: null }), null, [low, 0]), null);
});

async function dataset(works, scores, model = CORPUS_LIMIT.model) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corpus-limit-"));
  await mkdir(path.join(directory, "works"));
  const pageSize = 2;
  for (let index = 0, page = 1; index < works.length; index += pageSize, page += 1) {
    await writeFile(path.join(directory, "works", `page-${String(page).padStart(3, "0")}.json`), JSON.stringify({ schemaVersion: "works-1.0.0", generatedAt: "2026-01-01T00:00:00.000Z", page, pageSize, totalItems: works.length, totalPages: Math.ceil(works.length / pageSize), nextPage: null, items: works.slice(index, index + pageSize) }));
  }
  await writeFile(path.join(directory, "search-index.json"), JSON.stringify({ documents: works.map(({ id, title }) => ({ id, title })) }));
  await writeFile(path.join(directory, "meta.json"), JSON.stringify({ totalFound: works.length, totalAnalyzed: works.length, datasets: { publications: { recordCount: works.length }, preprints: { recordCount: 0 }, searchIndex: { recordCount: works.length } } }));
  await writeFile(path.join(directory, "similarity.json"), JSON.stringify({ model, thresholds: { core: 0.7, near: 0.6, edge: 0.5 }, coverage: { totalWorks: works.length, scoredWorks: Object.keys(scores).length, tierCounts: { core: 0, near: 0, edge: 0 } }, scores }));
  return directory;
}
const readJson = async (...parts) => JSON.parse(await readFile(path.join(...parts), "utf8"));

test("limit rewrites pages, index, counts and scores consistently and remembers what it dropped", async () => {
  const works = [work("core", "core"), work("far1", "broad"), work("near", "broad"), work("far2", "frontier"), work("cites", "citation"), work("new", "broad"), work("far3", "broad")];
  const scores = { core: [0.2, 0, 0], far1: [0.3, 0, 0], near: [0.65, 0, 0], far2: [0.1, 0, 0], cites: [0.2, 0, 0], far3: [0.44, 0, 0] };
  const directory = await dataset(works, scores);
  try {
    const report = await limitCorpus(directory);
    assert.equal(report.applied, true);
    assert.equal(report.keptWorks, 4);
    assert.equal(report.droppedThisRun, 3);
    assert.deepEqual(report.keptBy, { "core-venue": 1, "cites-library": 1, "close-to-library": 1, "awaiting-ranking": 1 });

    const names = (await readdir(path.join(directory, "works"))).sort();
    assert.deepEqual(names, ["page-001.json", "page-002.json"]);
    const pages = await Promise.all(names.map(name => readJson(directory, "works", name)));
    assert.deepEqual(pages.flatMap(page => page.items.map(item => item.id)), ["core", "near", "cites", "new"]);
    assert.ok(pages.every(page => page.totalItems === 4 && page.totalPages === 2));
    assert.equal(pages[0].nextPage, "./page-002.json");
    assert.equal(pages[1].nextPage, null);
    assert.equal(pages[1].items[0].pagePath, "./works/page-002.json");

    assert.deepEqual((await readJson(directory, "search-index.json")).documents.map(document => document.id), ["core", "near", "cites", "new"]);
    const meta = await readJson(directory, "meta.json");
    assert.equal(meta.totalFound, 4);
    assert.equal(meta.datasets.searchIndex.recordCount, 4);
    assert.deepEqual(meta.corpusLimit, { minScore: CORPUS_LIMIT.minScore, keptWorks: 4, keptBy: report.keptBy, excludedWorks: 3 });
    const similarity = await readJson(directory, "similarity.json");
    assert.deepEqual(Object.keys(similarity.scores), ["core", "near", "cites"]);
    assert.deepEqual(similarity.thresholds, { core: 0.7, near: 0.6, edge: 0.5 });
    assert.deepEqual(similarity.coverage.tierCounts, { core: 0, near: 1, edge: 0 });
    assert.equal(similarity.coverage.pendingWorks, 1);
    assert.deepEqual(await readExcludedScores(directory), { far1: [0.3, 1], far2: [0.1, 1], far3: [0.44, 1] });

    // A second run changes nothing.
    const again = await limitCorpus(directory);
    assert.equal(again.droppedThisRun, 0);
    assert.equal(again.excludedWorks, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a work fetched again stays out without a new ranking, unless it now cites the library", async () => {
  const directory = await dataset([work("core", "core"), work("far", "broad"), work("turn", "broad")], { core: [0.2, 0, 0], far: [0.3, 0, 0], turn: [0.3, 0, 0] });
  try {
    await limitCorpus(directory);
    // Next ingestion: both dropped works come back unranked, one of them through the citation search.
    const page = await readJson(directory, "works", "page-001.json");
    page.items.push(work("far", "broad"), work("turn", "citation"));
    page.totalItems = 3;
    await writeFile(path.join(directory, "works", "page-001.json"), JSON.stringify(page));
    const report = await limitCorpus(directory);
    assert.equal(report.droppedThisRun, 1);
    assert.equal(report.keptWorks, 2);
    assert.deepEqual(Object.keys(await readExcludedScores(directory)), ["far"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("limit stands back when the ranking is missing, from another model or would empty the corpus", async () => {
  const works = [work("a", "broad"), work("b", "broad"), work("c", "broad"), work("d", "broad"), work("e", "broad"), work("f", "broad")];
  const allLow = Object.fromEntries(works.map(item => [item.id, [0.1, 0, 0]]));
  for (const [scores, model, pattern] of [[allLow, "other/model", /anderen Modell/], [allLow, CORPUS_LIMIT.model, /fehlerhaftes Ranking/]]) {
    const directory = await dataset(works, scores, model);
    try {
      const report = await limitCorpus(directory);
      assert.equal(report.applied, false);
      assert.match(report.reason, pattern);
      assert.equal((await readJson(directory, "meta.json")).totalFound, 6);
      assert.equal((await readdir(path.join(directory, "works"))).length, 3);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("tier shares keep counting the works that were removed", async () => {
  const library = { profiles: [{ id: "p", label: "P" }], seeds: [{ title: "Seed", profiles: ["p"] }] };
  const vector = text => text.startsWith("Close") ? [1, 0.05] : text.startsWith("Seed") ? [1, 0] : [0.6, 0.8];
  const embed = async texts => texts.map(vector);
  const works = [{ id: "close", title: "Close work" }, { id: "mid", title: "Mid work" }];
  const alone = await rankLibrarySimilarity({ works, library, embed, cache: new Map(), model: "m" });
  const withRemoved = await rankLibrarySimilarity({ works, library, embed, cache: new Map(), model: "m", referenceScores: new Array(18).fill(0.1) });
  // Alone, only the closer of the two is in the top 20 %. With the 18 removed works counted, both are.
  assert.equal(alone.thresholds.edge, alone.scores.close[0]);
  assert.equal(alone.coverage.tierCounts.core + alone.coverage.tierCounts.near + alone.coverage.tierCounts.edge, 1);
  assert.equal(withRemoved.thresholds.edge, 0.1);
  assert.equal(withRemoved.coverage.tierCounts.core + withRemoved.coverage.tierCounts.near + withRemoved.coverage.tierCounts.edge, 2);
  assert.equal(withRemoved.coverage.totalWorks, 2);
});
