import assert from "node:assert/strict";
import test from "node:test";

import { authorEdges, authorKey, buildLibraryGraph, citationEdges, forceLayout, resolveCitations, similarityEdges } from "../../scripts/similarity/graph.mjs";
import { degreeTable, neighbourLists } from "../../site/assets/js/library-graph.js";

const seeds = [
  { title: "Work design A", author: "Parker", year: 2017, doi: "10.1/a", authors: ["Parker, Sharon K.", "Grote, Gudela"] },
  { title: "Work design B", author: "Parker", year: 2022, doi: "10.1/B", authors: ["Parker, S.", "Knight, Caroline"] },
  { title: "Trust C", author: "Lee", year: 2004, doi: "10.1/c", authors: ["Lee, John D.", "See, Katrina A."] },
  { title: "Book without DOI", author: "Polanyi", year: 1966, authors: ["Polanyi, Michael"] }
];
const library = { profiles: [{ id: "work", label: "Work" }, { id: "trust", label: "Trust" }], seeds };

test("matches authors by family name and first initial", () => {
  assert.equal(authorKey("Schraagen, Jan Maarten"), authorKey("Schraagen, J.M.C."));
  assert.equal(authorKey("Wäfler, Toni"), authorKey("Wafler, T."));
  assert.notEqual(authorKey("Parker, Sharon"), authorKey("Parker, Anna"));
  assert.equal(authorKey("OECD"), null);
  assert.deepEqual(authorEdges(seeds), [[0, 1, 1]]);
});

test("links works that cite each other inside the library only", () => {
  const records = [
    { id: "https://openalex.org/W1", doi: "https://doi.org/10.1/a", referenced_works: ["https://openalex.org/W3", "https://openalex.org/W999"] },
    { id: "https://openalex.org/W2", doi: "https://doi.org/10.1/b", referenced_works: ["https://openalex.org/W1", "https://openalex.org/W2"] },
    { id: "https://openalex.org/W3", doi: "https://doi.org/10.1/c", referenced_works: [] },
    { id: "https://openalex.org/W4", doi: "https://doi.org/10.9/unrelated", referenced_works: ["https://openalex.org/W1"] }
  ];
  assert.deepEqual(citationEdges(seeds, records), { resolved: 3, edges: [[0, 2], [1, 0]] });
});

test("requests only well-formed DOIs, without prefixes that read as filter syntax", async () => {
  const requested = [];
  const fetchImpl = async (url) => { requested.push(new URL(url).searchParams.get("filter")); return new Response(JSON.stringify({ results: [] }), { status: 200 }); };
  const { fetchSeedRecords } = await import("../../scripts/similarity/graph.mjs");
  const result = await fetchSeedRecords([{ doi: "doi: 10.1145/353071.353106" }, { doi: "https://doi.org/10.1016/0001-6918(81)90033-0" }, { doi: "10.1/a|type:preprint" }, { doi: "not-a-doi" }, {}], { fetchImpl });
  assert.deepEqual(requested, ["doi:10.1145/353071.353106|10.1016/0001-6918(81)90033-0"]);
  assert.equal(result.requested, 2);
});

test("connects each work to its closest works above the floor", () => {
  const vectors = [[1, 0, 0], [0.9, 0.436, 0], [0, 1, 0], [0, 0, 1]].map(values => Float32Array.from(values));
  assert.deepEqual(similarityEdges(vectors, 1, 0.4), [[0, 1, 0.9], [1, 2, 0.44]]);
  assert.deepEqual(similarityEdges(vectors, 1, 0.95), []);
});

test("layout is deterministic, stays in the unit square and sets unlinked works apart", () => {
  const edges = [[0, 1], [1, 2], [2, 0], [3, 4]];
  const first = forceLayout(8, edges, [0, 0, 0, 1, 1, 1, 0, 1]);
  assert.deepEqual(first, forceLayout(8, edges, [0, 0, 0, 1, 1, 1, 0, 1]));
  assert.ok(first.flat().every(value => value >= 0 && value <= 1));
  const lowestLinked = Math.max(...[0, 1, 2, 3, 4].map(node => first[node][1]));
  assert.ok([5, 6, 7].every(node => first[node][1] > lowestLinked), "unlinked works form rows below the network");
  assert.equal(new Set(first.map(point => point.join(","))).size, 8);
  assert.deepEqual(forceLayout(0, [], []), []);
});

test("reuses recent citation links, refreshes old ones and survives a failed request", async () => {
  const now = new Date("2026-11-20T00:00:00.000Z");
  let calls = 0;
  const fetchRecords = async () => { calls += 1; return { requested: 3, records: [{ id: "W1", doi: "10.1/a", referenced_works: ["W3"] }, { id: "W3", doi: "10.1/c", referenced_works: [] }] }; };
  const fresh = await resolveCitations(seeds, null, { now, fetchRecords });
  assert.deepEqual({ status: fresh.status, edges: fresh.edges, resolved: fresh.resolved, calls }, { status: "ready", edges: [[0, 2]], resolved: 2, calls: 1 });

  const vectors = [[1, 0], [0.9, 0.436], [0, 1], [0.7, 0.714]].map(values => Float32Array.from(values));
  const graph = buildLibraryGraph({ library, seedVectors: vectors, seedProfiles: [[0], [0], [1], [1]], citations: fresh, model: "stub", generatedAt: now.toISOString() });
  assert.deepEqual(Object.keys(graph.edges), ["citations", "similarity", "authors"]);
  assert.equal(graph.nodes[2].profile, "trust");
  assert.equal(graph.nodes[0].label, "Parker 2017: Work design A");
  assert.ok(graph.nodes.every(node => Object.values(node.positions).every(point => point.length === 2)));

  const reused = await resolveCitations(seeds, graph, { now: new Date("2026-11-23T00:00:00.000Z"), fetchRecords });
  assert.equal(calls, 1, "links younger than a week are not requested again");
  assert.deepEqual(reused.edges, [[0, 2]]);
  await resolveCitations(seeds, graph, { now: new Date("2026-11-30T00:00:00.000Z"), fetchRecords });
  assert.equal(calls, 2);
  await resolveCitations([...seeds, { title: "New", doi: "10.1/new" }], graph, { now, fetchRecords });
  assert.equal(calls, 3, "a changed library is requested again");

  const failing = async () => { throw new Error("OpenAlex antwortete mit HTTP 400: Invalid filter"); };
  const stale = await resolveCitations(seeds, graph, { now: new Date("2026-12-30T00:00:00.000Z"), fetchRecords: failing });
  assert.equal(stale.status, "ready");
  assert.match(stale.message, /älterer Stand/);
  const none = await resolveCitations(seeds, null, { now, fetchRecords: failing });
  assert.deepEqual({ status: none.status, edges: none.edges }, { status: "unavailable", edges: [] });
  assert.match(none.message, /HTTP 400/);
});

test("dashboard helpers count links per work and keep direction", () => {
  assert.deepEqual(degreeTable(4, [[0, 2], [1, 0]]), [2, 1, 1, 0]);
  assert.deepEqual(neighbourLists(3, [[0, 2], [1, 0]]), { out: [[2], [0], []], incoming: [[1], [], [0]] });
});
