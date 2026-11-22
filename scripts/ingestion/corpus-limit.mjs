import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// The searches stay broad, the published corpus does not: a work is kept when it
// comes from one of the core venues, cites the reference library, or is close
// enough to the library in content. Everything else is dropped and remembered,
// so that a work fetched again is neither embedded nor published a second time.
export const CORPUS_LIMIT = {
  version: "corpus-limit-1.0.0",
  // The threshold is a cosine similarity and only means something for this model.
  model: "Xenova/all-MiniLM-L6-v2",
  minScore: 0.45,
  keepModes: ["core", "citation"],
  // Refuse to act when a run would remove nearly everything: that is a broken ranking, not a quiet day.
  maxDropShare: 0.8
};
const FILE = "corpus-limit.json";

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(file, value) {
  await writeFile(`${file}.tmp`, JSON.stringify(value));
  await rename(`${file}.tmp`, file);
}

const hasAbstract = work => (typeof work.abstract === "string" && work.abstract.trim().length > 0) ? 1 : 0;

/**
 * Why a work stays, or null when it goes.
 * @param {object} work
 * @param {number|null} score similarity to the library, null when not ranked yet
 * @param {[number, number]|undefined} remembered earlier decision: [score, had an abstract]
 */
export function retentionReason(work, score, remembered, limit = CORPUS_LIMIT) {
  const modes = new Set((work.discoveredBy ?? []).map(entry => entry?.mode));
  if (modes.has("core")) return "core-venue";
  if (modes.has("citation") || (work.libraryCitations ?? []).length > 0) return "cites-library";
  if (score !== null) return score >= limit.minScore ? "close-to-library" : null;
  // Not ranked in this run. A work dropped before stays out, unless it has an abstract now
  // and was judged on its title alone back then.
  if (remembered) return hasAbstract(work) && !remembered[1] ? "awaiting-ranking" : null;
  return "awaiting-ranking";
}

export async function readExcludedScores(dataDirectory) {
  const state = await readJson(path.join(dataDirectory, FILE), null);
  return state?.excluded && typeof state.excluded === "object" ? state.excluded : {};
}

/**
 * Applies the limit to a data directory in place: works pages, search index,
 * counts in meta.json and the scores of the ranking. Safe to run repeatedly.
 */
export async function limitCorpus(dataDirectory, options = {}) {
  const limit = { ...CORPUS_LIMIT, ...(options.limit ?? {}) };
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const similarityFile = path.join(dataDirectory, "similarity.json");
  const similarity = await readJson(similarityFile, null);
  const previous = await readJson(path.join(dataDirectory, FILE), null);
  if (!similarity || similarity.model !== limit.model) return { applied: false, reason: similarity ? `Ranking stammt von einem anderen Modell (${similarity.model})` : "Kein Ranking vorhanden" };
  const sameBasis = previous?.model === limit.model && previous?.minScore === limit.minScore;
  const excluded = new Map(sameBasis ? Object.entries(previous.excluded ?? {}) : []);

  const worksDirectory = path.join(dataDirectory, "works");
  const names = (await readdir(worksDirectory)).filter(name => /^page-\d+\.json$/.test(name)).sort();
  const pages = [];
  for (const name of names) pages.push(JSON.parse(await readFile(path.join(worksDirectory, name), "utf8")));
  const works = pages.flatMap(page => Array.isArray(page.items) ? page.items : []);
  const reasons = { "core-venue": 0, "cites-library": 0, "close-to-library": 0, "awaiting-ranking": 0 };
  const kept = [];
  const dropped = [];
  for (const work of works) {
    const entry = similarity.scores?.[work.id];
    const score = Array.isArray(entry) && Number.isFinite(entry[0]) ? entry[0] : null;
    const reason = retentionReason(work, score, excluded.get(work.id), limit);
    if (reason) { reasons[reason] += 1; kept.push(work); excluded.delete(work.id); }
    else dropped.push([work.id, [score ?? excluded.get(work.id)?.[0] ?? 0, hasAbstract(work)]]);
  }
  if (works.length > 0 && dropped.length / works.length > limit.maxDropShare) {
    return { applied: false, reason: `Die Grenze würde ${dropped.length} von ${works.length} Arbeiten entfernen; das spricht für ein fehlerhaftes Ranking.` };
  }
  for (const [id, value] of dropped) excluded.set(id, value);

  if (dropped.length > 0) {
    const pageSize = pages[0]?.pageSize ?? options.pageSize ?? 200;
    const chunks = [];
    for (let index = 0; index < kept.length; index += pageSize) chunks.push(kept.slice(index, index + pageSize));
    if (chunks.length === 0) chunks.push([]);
    const pageName = index => `page-${String(index + 1).padStart(3, "0")}.json`;
    for (let index = 0; index < chunks.length; index += 1) {
      await writeJson(path.join(worksDirectory, pageName(index)), {
        ...pages[0], page: index + 1, pageSize, totalItems: kept.length, totalPages: kept.length === 0 ? 0 : chunks.length,
        nextPage: index + 1 < chunks.length ? `./${pageName(index + 1)}` : null,
        items: chunks[index].map(work => work.pagePath ? { ...work, pagePath: `./works/${pageName(index)}` } : work)
      });
    }
    for (const name of names.slice(chunks.length)) await unlink(path.join(worksDirectory, name));

    const keptIds = new Set(kept.map(work => work.id));
    const indexFile = path.join(dataDirectory, "search-index.json");
    const searchIndex = await readJson(indexFile, null);
    if (Array.isArray(searchIndex?.documents)) {
      searchIndex.documents = searchIndex.documents.filter(document => keptIds.has(document.id));
      await writeJson(indexFile, searchIndex);
    }
    // The ranking keeps its thresholds; only the scores of removed works leave the file.
    let scored = 0;
    const scores = {};
    for (const work of kept) if (similarity.scores?.[work.id]) { scores[work.id] = similarity.scores[work.id]; scored += 1; }
    const tierCounts = Object.fromEntries(Object.keys(similarity.coverage?.tierCounts ?? {}).map(tier => [tier, 0]));
    const order = Object.entries(similarity.thresholds ?? {}).filter(([, value]) => value !== null).sort((a, b) => b[1] - a[1]);
    for (const [score] of Object.values(scores)) {
      const tier = order.find(([, value]) => score >= value)?.[0];
      if (tier && tier in tierCounts) tierCounts[tier] += 1;
    }
    similarity.scores = scores;
    similarity.coverage = { ...similarity.coverage, totalWorks: kept.length, scoredWorks: scored, pendingWorks: kept.length - scored, tierCounts };
    await writeJson(similarityFile, similarity);
  }

  const metaFile = path.join(dataDirectory, "meta.json");
  const meta = await readJson(metaFile, null);
  if (meta) {
    if (dropped.length > 0) {
      meta.totalFound = kept.length;
      if (Number.isInteger(meta.totalAnalyzed)) meta.totalAnalyzed = Math.min(meta.totalAnalyzed, kept.length);
      const count = type => kept.filter(work => work.recordType === type).length;
      if (meta.datasets?.publications) meta.datasets.publications.recordCount = count("publication");
      if (meta.datasets?.preprints) meta.datasets.preprints.recordCount = count("preprint");
      if (meta.datasets?.searchIndex) meta.datasets.searchIndex.recordCount = kept.length;
    }
    // Summary for the page; the list of removed works stays in its own file.
    meta.corpusLimit = { minScore: limit.minScore, keptWorks: kept.length, keptBy: reasons, excludedWorks: excluded.size };
    await writeFile(metaFile, JSON.stringify(meta, null, 2));
  }

  const state = {
    schemaVersion: limit.version,
    generatedAt: dropped.length > 0 || !previous ? generatedAt : previous.generatedAt,
    model: limit.model,
    minScore: limit.minScore,
    rule: "Behalten werden Arbeiten aus den Kernzeitschriften und -konferenzen, Arbeiten, die die Referenzbibliothek zitieren, und Arbeiten mit ausreichender inhaltlicher Nähe zur Bibliothek.",
    keptWorks: kept.length,
    keptBy: reasons,
    excludedWorks: excluded.size,
    excluded: Object.fromEntries(excluded)
  };
  await writeJson(path.join(dataDirectory, FILE), state);
  return { applied: true, minScore: limit.minScore, keptWorks: kept.length, keptBy: reasons, droppedThisRun: dropped.length, excludedWorks: excluded.size };
}
