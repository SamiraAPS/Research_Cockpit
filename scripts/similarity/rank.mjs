import { createHash } from "node:crypto";

// Ranks corpus works by how close they are to the personal reference library.
// Closeness is the cosine similarity of sentence embeddings; nothing here
// decides relevance on its own, it only orders and groups what was retrieved.
export const SIMILARITY_VERSION = "library-similarity-1.0.0";
export const TOP_SEEDS = 3;
export const TIERS = [
  { id: "core", share: 0.02 },
  { id: "near", share: 0.10 },
  { id: "edge", share: 0.20 }
];

const MAX_TEXT_LENGTH = 1200;

export function workText(work) {
  const abstract = typeof work.abstract === "string" ? work.abstract : "";
  return `${work.title ?? ""}. ${abstract}`.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

export function textFingerprint(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function libraryFingerprint(library, model) {
  const seeds = library.seeds.map(seed => [seed.title, [...(seed.profiles ?? [])].sort()]);
  return createHash("sha256").update(JSON.stringify([SIMILARITY_VERSION, model, library.profiles.map(profile => profile.id), seeds])).digest("hex").slice(0, 16);
}

export function seedLabel(seed) {
  const lead = [seed.author, seed.year].filter(Boolean).join(" ");
  const title = seed.title.length > 90 ? `${seed.title.slice(0, 87)}…` : seed.title;
  return lead ? `${lead}: ${title}` : title;
}

export function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Embedding ohne Länge");
  const result = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) result[index] = vector[index] / norm;
  return result;
}

// Vectors are stored as signed bytes: a quarter of the size at a precision
// that does not change the ordering in any way that matters here.
export function quantize(vector) {
  const result = new Int8Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) result[index] = Math.max(-127, Math.min(127, Math.round(vector[index] * 127)));
  return result;
}

function dot(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function unit(bytes) {
  return normalize(Float32Array.from(bytes));
}

// Seeds without a title-based profile join the profile whose seeds they are
// closest to, so the whole library contributes to exactly the listed profiles.
export function assignProfiles(library, seedVectors) {
  const profileIds = library.profiles.map(profile => profile.id);
  const dimension = seedVectors[0].length;
  const centroids = profileIds.map((id) => {
    const sum = new Float32Array(dimension);
    let count = 0;
    library.seeds.forEach((seed, index) => {
      if (!(seed.profiles ?? []).includes(id)) return;
      for (let d = 0; d < dimension; d += 1) sum[d] += seedVectors[index][d];
      count += 1;
    });
    return count ? normalize(sum) : null;
  });
  return library.seeds.map((seed, index) => {
    const own = (seed.profiles ?? []).map(id => profileIds.indexOf(id)).filter(position => position >= 0);
    if (own.length) return own;
    let best = -1, bestScore = -Infinity;
    centroids.forEach((centroid, position) => {
      if (!centroid) return;
      const score = dot(centroid, seedVectors[index]);
      if (score > bestScore) { bestScore = score; best = position; }
    });
    return best >= 0 ? [best] : [];
  });
}

export function scoreVector(vector, seedVectors, seedProfiles, profileCount) {
  const tops = Array.from({ length: profileCount }, () => []);
  let nearest = -1, nearestScore = -Infinity;
  for (let index = 0; index < seedVectors.length; index += 1) {
    const similarity = dot(vector, seedVectors[index]);
    if (similarity > nearestScore) { nearestScore = similarity; nearest = index; }
    for (const profile of seedProfiles[index]) {
      const top = tops[profile];
      if (top.length < TOP_SEEDS) { top.push(similarity); top.sort((a, b) => b - a); }
      else if (similarity > top[TOP_SEEDS - 1]) { top[TOP_SEEDS - 1] = similarity; top.sort((a, b) => b - a); }
    }
  }
  let profile = -1, score = -Infinity;
  tops.forEach((top, position) => {
    if (!top.length) return;
    const mean = top.reduce((sum, value) => sum + value, 0) / top.length;
    if (mean > score) { score = mean; profile = position; }
  });
  return { score, profile, seed: nearest };
}

export function tierThresholds(scores) {
  const sorted = [...scores].sort((a, b) => b - a);
  return Object.fromEntries(TIERS.map(({ id, share }) => {
    const count = Math.max(1, Math.ceil(sorted.length * share));
    return [id, sorted.length ? sorted[Math.min(sorted.length, count) - 1] : null];
  }));
}

export function tierFor(score, thresholds) {
  for (const { id } of TIERS) if (thresholds[id] !== null && score >= thresholds[id]) return id;
  return null;
}

/**
 * @param {object} input
 * @param {Array<{id:string,title:string,abstract?:string|null,firstSeenAt?:string,publicationDate?:string}>} input.works
 * @param {{profiles:Array<{id:string,label:string}>,seeds:Array<object>}} input.library
 * @param {(texts:string[]) => Promise<ArrayLike<number>[]>} input.embed
 * @param {Map<string,{fingerprint:string,vector:Int8Array}>} input.cache  updated in place
 * @param {object|null} input.previous  last similarity.json, used to carry scores over when vectors are missing
 * @param {{seedVectors:Float32Array[],seedProfiles:number[][]}} [input.seeds]  result of embedLibrary, if already computed
 */
export async function embedLibrary(library, embed, batchSize = 32) {
  if (!library.seeds.length || !library.profiles.length) throw new Error("Referenzbibliothek ohne Profile oder Arbeiten");
  const seedVectors = (await embedAll(library.seeds.map(seed => seed.title), embed, batchSize)).map(normalize);
  return { seedVectors, seedProfiles: assignProfiles(library, seedVectors) };
}

export async function rankLibrarySimilarity({ works, library, embed, cache, model, previous = null, seeds = null, generatedAt = new Date().toISOString(), deadline = Infinity, batchSize = 32, now = () => Date.now() }) {
  const libraryHash = libraryFingerprint(library, model);
  const { seedVectors, seedProfiles } = seeds ?? await embedLibrary(library, embed, batchSize);

  const texts = new Map(works.map(work => [work.id, workText(work)]));
  // A work published with an excerpt only keeps the fingerprint of its full text,
  // so the vector computed from the full text stays valid.
  const fingerprints = new Map(works.map(work => [work.id, work.abstractDigest ?? textFingerprint(texts.get(work.id))]));
  const pending = works
    .filter((work) => cache.get(work.id)?.fingerprint !== fingerprints.get(work.id))
    .sort((a, b) => String(b.firstSeenAt ?? b.publicationDate ?? "").localeCompare(String(a.firstSeenAt ?? a.publicationDate ?? "")));
  let embedded = 0;
  for (let offset = 0; offset < pending.length && now() < deadline; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const vectors = await embed(batch.map(work => texts.get(work.id)));
    batch.forEach((work, index) => {
      cache.set(work.id, { fingerprint: fingerprints.get(work.id), vector: quantize(normalize(vectors[index])) });
    });
    embedded += batch.length;
  }
  const known = new Set(works.map(work => work.id));
  for (const id of [...cache.keys()]) if (!known.has(id)) cache.delete(id);

  const carried = previous?.libraryHash === libraryHash && previous?.model === model ? previous.scores ?? {} : {};
  const entries = new Map();
  let carriedCount = 0;
  for (const work of works) {
    const cached = cache.get(work.id);
    if (cached && cached.fingerprint === fingerprints.get(work.id)) {
      entries.set(work.id, scoreVector(unit(cached.vector), seedVectors, seedProfiles, library.profiles.length));
    } else if (Array.isArray(carried[work.id])) {
      const [score, profile, seed] = carried[work.id];
      entries.set(work.id, { score, profile, seed });
      carriedCount += 1;
    }
  }
  const thresholds = tierThresholds([...entries.values()].map(entry => entry.score));
  const scores = {};
  const tierCounts = Object.fromEntries(TIERS.map(tier => [tier.id, 0]));
  for (const [id, entry] of entries) {
    const score = Math.round(entry.score * 1000) / 1000;
    scores[id] = [score, entry.profile, entry.seed];
    const tier = tierFor(entry.score, thresholds);
    if (tier) tierCounts[tier] += 1;
  }
  return {
    schemaVersion: "similarity-1.0.0",
    generatedAt,
    methodVersion: SIMILARITY_VERSION,
    model,
    libraryHash,
    method: `Mittel der ${TOP_SEEDS} höchsten Kosinus-Ähnlichkeiten zwischen Titel/Abstract einer Arbeit und den Titeln der Referenzarbeiten eines Profils; es zählt das nächste Profil.`,
    profiles: library.profiles.map((profile, position) => ({ id: profile.id, label: profile.label, seedCount: seedProfiles.filter(list => list.includes(position)).length })),
    seeds: library.seeds.map(seedLabel),
    seedDois: library.seeds.map(seed => seed.doi ? String(seed.doi).toLowerCase() : null),
    thresholds: Object.fromEntries(Object.entries(thresholds).map(([id, value]) => [id, value === null ? null : Math.round(value * 1000) / 1000])),
    coverage: { totalWorks: works.length, scoredWorks: entries.size, embeddedThisRun: embedded, pendingWorks: works.length - entries.size, carriedForward: carriedCount, tierCounts },
    scores
  };
}

async function embedAll(texts, embed, batchSize) {
  const result = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) result.push(...await embed(texts.slice(offset, offset + batchSize)));
  return result;
}

// Compact per-work view used by the analysis pipeline and the dashboard.
export function libraryEntries(similarity) {
  const entries = new Map();
  if (!similarity?.scores) return entries;
  const thresholds = similarity.thresholds ?? {};
  for (const [id, value] of Object.entries(similarity.scores)) {
    if (!Array.isArray(value)) continue;
    const [score, profile, seed] = value;
    const profileId = similarity.profiles?.[profile]?.id;
    if (!Number.isFinite(score) || !profileId) continue;
    entries.set(id, { score, profile: profileId, tier: tierFor(score, thresholds), seed: Number.isInteger(seed) && seed >= 0 ? seed : null });
  }
  return entries;
}
