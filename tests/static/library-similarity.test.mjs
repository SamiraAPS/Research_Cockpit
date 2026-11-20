import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { libraryEntries, rankLibrarySimilarity, tierFor, tierThresholds, workText } from "../../scripts/similarity/rank.mjs";
import { loadVectorCache, saveVectorCache } from "../../scripts/similarity/store.mjs";
import { matchesLibrary, sortWorkResults } from "../../site/assets/js/search.js";
import { catalogDocument, catalogWork } from "../../site/assets/js/catalog.js";

// Deterministic stand-in for the sentence model: hashed bag of words.
function stubEmbedder(dimension = 64) {
  const calls = [];
  const embed = async (texts) => {
    calls.push(texts.length);
    return texts.map((text) => {
      const vector = new Float32Array(dimension);
      for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2)) {
        const hash = createHash("md5").update(token).digest();
        for (let k = 0; k < 4; k += 1) vector[hash.readUInt16LE(k * 2) % dimension] += (hash[8 + k] & 1) ? 1 : -1;
      }
      if (!vector.some(Boolean)) vector[0] = 1;
      return vector;
    });
  };
  return { embed, calls };
}

const library = {
  profiles: [{ id: "work-design", label: "Work Design" }, { id: "trust", label: "Trust" }],
  seeds: [
    { title: "Work design and job autonomy of employees", author: "Parker", year: 2017, profiles: ["work-design"] },
    { title: "Job characteristics and intrinsic work motivation", profiles: ["work-design"] },
    { title: "Trust in automation and appropriate reliance", author: "Lee", year: 2004, profiles: ["trust"] },
    { title: "Calibrating trust in artificial intelligence advice", profiles: ["trust"] },
    { title: "Reliance on automation advice under uncertainty", profiles: [] }
  ]
};
const works = [
  { id: "w-design", title: "Job autonomy and work design in automated work", abstract: "Employees and job characteristics.", firstSeenAt: "2026-11-03T00:00:00.000Z" },
  { id: "w-trust", title: "Appropriate reliance and trust in automation advice", abstract: null, firstSeenAt: "2026-11-02T00:00:00.000Z" },
  { id: "w-far", title: "Soil nitrogen dynamics in alpine meadows", abstract: "Seasonal sampling of grassland plots.", firstSeenAt: "2026-11-01T00:00:00.000Z" }
];

test("ranks works by closeness to the nearest profile and names the closest reference", async () => {
  const { embed } = stubEmbedder();
  const result = await rankLibrarySimilarity({ works, library, embed, cache: new Map(), model: "stub", generatedAt: "2026-11-20T00:00:00.000Z" });
  assert.equal(result.schemaVersion, "similarity-1.0.0");
  assert.deepEqual(result.coverage, { totalWorks: 3, scoredWorks: 3, embeddedThisRun: 3, pendingWorks: 0, carriedForward: 0, tierCounts: result.coverage.tierCounts });
  const [designScore, designProfile, designSeed] = result.scores["w-design"];
  const [trustScore, trustProfile] = result.scores["w-trust"];
  assert.equal(result.profiles[designProfile].id, "work-design");
  assert.equal(result.profiles[trustProfile].id, "trust");
  assert.equal(result.seeds[designSeed], "Parker 2017: Work design and job autonomy of employees");
  assert.ok(designScore > result.scores["w-far"][0] && trustScore > result.scores["w-far"][0]);
  // A seed without a title-based profile joins the profile it is closest to.
  assert.deepEqual(result.profiles.map(profile => profile.seedCount), [2, 3]);
});

test("embeds newest works first within the time budget and continues from the cache", async () => {
  const limited = new Map();
  let ticks = 0;
  // The clock starts below the deadline, so exactly one batch of works is embedded.
  const budgeted = await rankLibrarySimilarity({ works, library, embed: stubEmbedder().embed, cache: limited, model: "stub", batchSize: 1, deadline: 1, now: () => ticks++ });
  assert.deepEqual([...limited.keys()], ["w-design"], "newest work is embedded first");
  assert.equal(budgeted.coverage.pendingWorks, 2);

  const second = stubEmbedder();
  const complete = await rankLibrarySimilarity({ works, library, embed: second.embed, cache: limited, model: "stub", batchSize: 8, previous: budgeted });
  assert.equal(complete.coverage.embeddedThisRun, 2, "cached vectors are not recomputed");
  assert.equal(complete.coverage.scoredWorks, 3);

  // A changed text is embedded again; a removed work leaves the cache.
  const changed = [{ ...works[0], abstract: "Now about trust in automation." }, works[1]];
  const third = await rankLibrarySimilarity({ works: changed, library, embed: stubEmbedder().embed, cache: limited, model: "stub" });
  assert.equal(third.coverage.embeddedThisRun, 1);
  assert.equal(limited.has("w-far"), false);
});

test("keeps earlier scores when vectors are missing but library and model are unchanged", async () => {
  const full = await rankLibrarySimilarity({ works, library, embed: stubEmbedder().embed, cache: new Map(), model: "stub" });
  let ticks = 0;
  const carried = await rankLibrarySimilarity({ works, library, embed: stubEmbedder().embed, cache: new Map(), model: "stub", previous: full, batchSize: 1, deadline: 1, now: () => ticks++ });
  assert.equal(carried.coverage.scoredWorks, 3);
  assert.equal(carried.coverage.carriedForward, 2);
  assert.deepEqual(carried.scores["w-far"], full.scores["w-far"]);
  ticks = 0;
  const otherLibrary = { ...library, seeds: library.seeds.slice(0, 4) };
  const reset = await rankLibrarySimilarity({ works, library: otherLibrary, embed: stubEmbedder().embed, cache: new Map(), model: "stub", previous: full, batchSize: 1, deadline: 1, now: () => ticks++ });
  assert.equal(reset.coverage.carriedForward, 0, "scores from another library version are not reused");
});

test("vector cache survives a round trip and ignores another model", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "similarity-cache-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new Map([["a", { fingerprint: "f1", vector: Int8Array.from([1, -2, 127]) }], ["b", { fingerprint: "f2", vector: Int8Array.from([0, 5, -127]) }]]);
  await saveVectorCache(directory, "stub", cache);
  const loaded = await loadVectorCache(directory, "stub");
  assert.deepEqual([...loaded.entries()], [...cache.entries()]);
  assert.equal((await loadVectorCache(directory, "other-model")).size, 0);
  assert.equal((await loadVectorCache(path.join(directory, "missing"), "stub")).size, 0);
  assert.equal(JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")).dimension, 3);
});

test("tiers, catalog contract and dashboard filter agree", () => {
  const thresholds = tierThresholds(Array.from({ length: 100 }, (_, index) => index / 100));
  assert.deepEqual(thresholds, { core: 0.98, near: 0.9, edge: 0.8 });
  assert.deepEqual([0.99, 0.95, 0.85, 0.5].map(score => tierFor(score, thresholds)), ["core", "near", "edge", null]);
  assert.equal(workText({ title: "A", abstract: null }), "A.");

  const similarity = { profiles: [{ id: "trust", label: "Trust", seedCount: 2 }], seeds: ["Lee 2004: Trust"], thresholds, scores: { w1: [0.95, 0, 0], broken: "x" } };
  const entries = libraryEntries(similarity);
  assert.deepEqual(entries.get("w1"), { score: 0.95, profile: "trust", tier: "near", seed: 0 });
  assert.equal(entries.has("broken"), false);

  const work = { id: "w1", recordType: "publication", title: "T", authors: [], venue: null, publicationDate: "2026-01-01", classifiedThemes: [], url: null, pagePath: "./works/page-001.json", research: { relevance: { areas: [], status: "included" }, personalFit: [], library: entries.get("w1") } };
  const restored = catalogWork(catalogDocument(work));
  assert.deepEqual(restored.research.library, entries.get("w1"));

  assert.equal(matchesLibrary(restored.research.library, "near", "trust"), true);
  assert.equal(matchesLibrary(restored.research.library, "core"), false);
  assert.equal(matchesLibrary(restored.research.library, "edge-only"), false);
  assert.equal(matchesLibrary(restored.research.library, "all", "work-design"), false);
  assert.equal(matchesLibrary(null, "all", "all"), true);
  assert.equal(matchesLibrary(null, "edge"), false);

  const unranked = { work: { title: "U", publicationDate: "2026-02-01", research: { library: null } } };
  const ranked = { work: { title: "R", publicationDate: "2025-01-01", research: { library: { score: 0.4 } } } };
  assert.deepEqual(sortWorkResults([unranked, ranked], "library").map(result => result.work.title), ["R", "U"]);
});
