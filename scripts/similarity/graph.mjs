import { createHash } from "node:crypto";

import { fetchWithRetry } from "../ingestion/http.mjs";
import { seedLabel } from "./rank.mjs";

// Network of the reference library with three kinds of links between the same
// works: who cites whom, what is closest in content, who shares authors.
export const GRAPH_VERSION = "library-graph-1.0.0";
export const SIMILARITY_NEIGHBOURS = 3;
export const SIMILARITY_FLOOR = 0.45;
export const CITATION_MAX_AGE_DAYS = 7;
const DOI_BATCH = 40;

function dot(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function unique(edges) {
  const seen = new Map();
  for (const [a, b, weight = 1] of edges) {
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const previous = seen.get(key);
    if (!previous || weight > previous[2]) seen.set(key, [Math.min(a, b), Math.max(a, b), weight]);
  }
  return [...seen.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

// Each work is linked to its closest works in content, whether or not they cite each other.
export function similarityEdges(seedVectors, neighbours = SIMILARITY_NEIGHBOURS, floor = SIMILARITY_FLOOR) {
  const edges = [];
  for (let a = 0; a < seedVectors.length; a += 1) {
    const scored = [];
    for (let b = 0; b < seedVectors.length; b += 1) {
      if (a === b) continue;
      const similarity = dot(seedVectors[a], seedVectors[b]);
      if (similarity >= floor) scored.push([b, similarity]);
    }
    scored.sort((x, y) => y[1] - x[1]);
    for (const [b, similarity] of scored.slice(0, neighbours)) edges.push([a, b, Math.round(similarity * 100) / 100]);
  }
  return unique(edges);
}

// "Schraagen, Jan Maarten" and "Schraagen, J.M.C." are the same person here:
// family name plus first initial. Collisions are possible and accepted.
export function authorKey(name) {
  const plain = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = plain.trim().split(/\s+/);
  // A single word is an institution ("OECD"), not a person.
  if (!plain.includes(",") && words.length < 2) return null;
  const [family, given = ""] = plain.includes(",") ? plain.split(",") : [words.at(-1), words[0]];
  const cleanFamily = family.replace(/[^a-z]/g, "");
  const initial = given.replace(/[^a-z]/g, "").slice(0, 1);
  return cleanFamily.length > 1 && initial ? `${cleanFamily}:${initial}` : null;
}

export function authorEdges(seeds) {
  const byAuthor = new Map();
  seeds.forEach((seed, index) => {
    for (const key of new Set((seed.authors ?? []).map(authorKey).filter(Boolean))) {
      if (!byAuthor.has(key)) byAuthor.set(key, []);
      byAuthor.get(key).push(index);
    }
  });
  const shared = new Map();
  for (const members of byAuthor.values()) {
    for (let i = 0; i < members.length; i += 1) for (let j = i + 1; j < members.length; j += 1) {
      const key = `${members[i]}:${members[j]}`;
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  return [...shared].map(([key, count]) => [...key.split(":").map(Number), count]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

const bareDoi = value => String(value ?? "").trim().toLowerCase().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi\s*:?\s*)/, "");
// Only well-formed DOIs go into a request: anything else could be read as filter syntax.
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s,|]+$/;
const shortId = value => String(value ?? "").replace(/^https?:\/\/openalex\.org\//i, "");

// Directed links [citing, cited] between works that are both in the library.
export function citationEdges(seeds, records) {
  const seedByDoi = new Map();
  seeds.forEach((seed, index) => { if (seed.doi && !seedByDoi.has(bareDoi(seed.doi))) seedByDoi.set(bareDoi(seed.doi), index); });
  const seedByWork = new Map();
  const resolved = [];
  for (const record of records) {
    const index = seedByDoi.get(bareDoi(record.doi));
    if (index === undefined || seedByWork.has(shortId(record.id))) continue;
    seedByWork.set(shortId(record.id), index);
    resolved.push([index, record]);
  }
  const edges = new Set();
  for (const [index, record] of resolved) {
    for (const reference of record.referenced_works ?? []) {
      const cited = seedByWork.get(shortId(reference));
      if (cited !== undefined && cited !== index) edges.add(`${index}:${cited}`);
    }
  }
  const ids = new Array(seeds.length).fill(null);
  for (const [index, record] of resolved) ids[index] = shortId(record.id);
  return {
    resolved: resolved.length,
    ids,
    edges: [...edges].map(key => key.split(":").map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  };
}

export function citationKey(seeds) {
  return createHash("sha256").update(JSON.stringify(seeds.map(seed => bareDoi(seed.doi)))).digest("hex").slice(0, 16);
}

export async function fetchSeedRecords(seeds, { apiKey, fetchImpl, timeoutMs = 20000 } = {}) {
  const dois = [...new Set(seeds.map(seed => bareDoi(seed.doi)).filter(doi => DOI_PATTERN.test(doi)))];
  const records = [];
  for (let offset = 0; offset < dois.length; offset += DOI_BATCH) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("filter", `doi:${dois.slice(offset, offset + DOI_BATCH).join("|")}`);
    url.searchParams.set("select", "id,doi,referenced_works");
    url.searchParams.set("per_page", "100");
    if (apiKey) url.searchParams.set("api_key", apiKey);
    const { response } = await fetchWithRetry(url, { source: "OpenAlex", fetchImpl, timeoutMs, maxAttempts: 3, init: { headers: { Accept: "application/json", "User-Agent": "HumanAIResearchRadar/4.0" } } });
    const payload = await response.json();
    if (!Array.isArray(payload.results)) throw new Error("OpenAlex-Antwort enthält kein results-Array");
    records.push(...payload.results);
  }
  return { records, requested: dois.length };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic force layout for the works that have links in a view. Hubs pull
 * less per link, so a densely cited core spreads out instead of collapsing.
 * Works without any link are set in rows below the network, grouped by profile.
 * Returns coordinates in [0, 1].
 */
export function forceLayout(count, edges, groups, { iterations = 400, seed = 7 } = {}) {
  if (!count) return [];
  const degree = new Array(count).fill(0);
  for (const [a, b] of edges) { degree[a] += 1; degree[b] += 1; }
  const byGroup = (a, b) => (groups[a] ?? 0) - (groups[b] ?? 0) || a - b;
  const linked = [...Array(count).keys()].filter(node => degree[node] > 0).sort(byGroup);
  const isolated = [...Array(count).keys()].filter(node => degree[node] === 0).sort(byGroup);
  const result = new Array(count);
  const round = value => Math.round(value * 10000) / 10000;

  // Rows of unlinked works at the bottom; the network gets the rest of the square.
  const perRow = Math.max(1, Math.ceil(Math.sqrt(count) * 2.6));
  const rows = Math.ceil(isolated.length / perRow);
  const stripHeight = isolated.length ? Math.min(0.3, 0.035 * rows + 0.02) : 0;
  isolated.forEach((node, position) => {
    const row = Math.floor(position / perRow), column = position % perRow;
    result[node] = [round(0.03 + (0.94 * (column + 0.5)) / perRow), round(1 - stripHeight + 0.02 + (row + 0.5) * 0.035)];
  });
  if (!linked.length) return result;

  const random = mulberry32(seed);
  const n = linked.length;
  const slot = new Map(linked.map((node, position) => [node, position]));
  const x = new Float64Array(n), y = new Float64Array(n);
  linked.forEach((_, position) => {
    const angle = (2 * Math.PI * position) / n;
    const radius = 0.3 + random() * 0.15;
    x[position] = Math.cos(angle) * radius; y[position] = Math.sin(angle) * radius;
  });
  // Degree-weighted repulsion with linear attraction (as in ForceAtlas2): well
  // connected works claim room around them, so a dense core opens up. Gravity
  // grows with distance and keeps small separate groups close to the rest.
  const mass = linked.map(node => degree[node] + 1);
  const links = edges.map(([a, b]) => [slot.get(a), slot.get(b)]);
  const repulsion = 0.0006, gravity = 0.9;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let step = 0; step < iterations; step += 1) {
    dx.fill(0); dy.fill(0);
    for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) {
      let ox = x[a] - x[b], oy = y[a] - y[b];
      let distance = Math.hypot(ox, oy);
      if (distance < 1e-6) { ox = (random() - 0.5) * 1e-3; oy = (random() - 0.5) * 1e-3; distance = Math.hypot(ox, oy); }
      const force = (repulsion * mass[a] * mass[b]) / (distance * distance);
      dx[a] += ox * force; dy[a] += oy * force; dx[b] -= ox * force; dy[b] -= oy * force;
    }
    for (const [a, b] of links) {
      const ox = x[a] - x[b], oy = y[a] - y[b];
      dx[a] -= ox; dy[a] -= oy; dx[b] += ox; dy[b] += oy;
    }
    const limit = 0.05 * (1 - step / iterations) + 0.0005;
    for (let node = 0; node < n; node += 1) {
      dx[node] -= x[node] * gravity * mass[node]; dy[node] -= y[node] * gravity * mass[node];
      // Heavy works move more slowly, which keeps hubs from oscillating.
      const length = Math.hypot(dx[node], dy[node]) || 1e-9;
      const move = Math.min(length / mass[node], limit);
      x[node] += (dx[node] / length) * move; y[node] += (dy[node] / length) * move;
    }
  }
  // Scale by the bulk of the works; a few far-out ones are pulled in to the frame.
  const sortedX = [...x].sort((p, q) => p - q), sortedY = [...y].sort((p, q) => p - q);
  const at = (sorted, share) => sorted[Math.min(n - 1, Math.max(0, Math.round(share * (n - 1))))];
  const minX = at(sortedX, 0.01), maxX = at(sortedX, 0.99), minY = at(sortedY, 0.01), maxY = at(sortedY, 0.99);
  const width = 0.9, height = 0.92 - stripHeight;
  const scale = Math.min(width / ((maxX - minX) || 1), height / ((maxY - minY) || 1));
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  linked.forEach((node, position) => {
    result[node] = [
      round(clamp(0.5 + (x[position] - (minX + maxX) / 2) * scale, 0.02, 0.98)),
      round(clamp(0.02 + (0.96 - stripHeight) / 2 + (y[position] - (minY + maxY) / 2) * scale, 0.02, 0.98 - stripHeight))
    ];
  });
  return result;
}

/**
 * @param {object} input
 * @param {object} input.library         config/reference-library.json
 * @param {Float32Array[]} input.seedVectors
 * @param {number[][]} input.seedProfiles  profile positions per work
 * @param {{status:string,fetchedAt:string|null,key:string|null,resolved:number,requested:number,edges:number[][],message:string|null}} input.citations
 */
export function buildLibraryGraph({ library, seedVectors, seedProfiles, citations, model, generatedAt = new Date().toISOString() }) {
  const seeds = library.seeds;
  const groups = seedProfiles.map(list => list[0] ?? 0);
  const edges = {
    citations: citations.edges,
    similarity: similarityEdges(seedVectors),
    authors: authorEdges(seeds)
  };
  const positions = Object.fromEntries(Object.entries(edges).map(([mode, list]) => [mode, forceLayout(seeds.length, list, groups)]));
  return {
    schemaVersion: GRAPH_VERSION,
    generatedAt,
    model,
    profiles: library.profiles.map(profile => ({ id: profile.id, label: profile.label })),
    modes: {
      citations: { label: "Zitationen", directed: true, status: citations.status, fetchedAt: citations.fetchedAt, libraryKey: citations.key, resolvedWorks: citations.resolved, requestedWorks: citations.requested, message: citations.message ?? null,
        description: "Eine Linie verbindet zwei Arbeiten der Bibliothek, wenn die eine die andere zitiert (Literaturlisten aus OpenAlex)." },
      similarity: { label: "Inhaltliche Nähe", directed: false, status: "ready",
        description: `Jede Arbeit ist mit ihren bis zu ${SIMILARITY_NEIGHBOURS} inhaltlich nächsten Arbeiten verbunden (Kosinus-Ähnlichkeit der Titel ab ${SIMILARITY_FLOOR}).` },
      authors: { label: "Gemeinsame Autor:innen", directed: false, status: "ready",
        description: "Eine Linie verbindet zwei Arbeiten mit mindestens einer gemeinsamen Autorin oder einem gemeinsamen Autor (Abgleich über Nachname und ersten Vornamensbuchstaben)." }
    },
    nodes: seeds.map((seed, index) => ({
      label: seedLabel(seed), title: seed.title, year: seed.year ?? null, authors: seed.authors ?? [], doi: seed.doi ?? null,
      profile: library.profiles[groups[index]]?.id ?? null,
      openalex: citations.ids?.[index] ?? null,
      positions: Object.fromEntries(Object.keys(edges).map(mode => [mode, positions[mode][index]]))
    })),
    edges
  };
}

/** Reuses last week's citation links when the library is unchanged; otherwise asks OpenAlex. Never throws. */
export async function resolveCitations(seeds, previous, { apiKey, fetchImpl, now = new Date(), fetchRecords = fetchSeedRecords } = {}) {
  const key = citationKey(seeds);
  const last = previous?.modes?.citations;
  // The ids of the references are needed by the citation search, so a graph without them is fetched again.
  const reusable = last?.status === "ready" && last.libraryKey === key && Array.isArray(previous?.edges?.citations)
    && previous.nodes?.length === seeds.length && previous.nodes.some(node => node.openalex);
  const age = last?.fetchedAt ? (now.getTime() - Date.parse(last.fetchedAt)) / 86_400_000 : Infinity;
  const kept = () => ({ status: "ready", fetchedAt: last.fetchedAt, key, resolved: last.resolvedWorks ?? 0, requested: last.requestedWorks ?? 0, edges: previous.edges.citations, ids: previous.nodes.map(node => node.openalex ?? null), message: null });
  if (reusable && age < CITATION_MAX_AGE_DAYS) return kept();
  try {
    const { records, requested } = await fetchRecords(seeds, { apiKey, fetchImpl });
    const { resolved, edges, ids } = citationEdges(seeds, records);
    return { status: "ready", fetchedAt: now.toISOString(), key, resolved, requested, edges, ids, message: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (reusable) return { ...kept(), message: `Aktualisierung fehlgeschlagen, älterer Stand wird gezeigt: ${message}` };
    return { status: "unavailable", fetchedAt: null, key, resolved: 0, requested: 0, edges: [], ids: [], message };
  }
}
