import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyWork } from "./classification.mjs";
import { buildStaticMetrics } from "./metrics.mjs";
import {
  ANALYSIS_VERSION,
  CLASSIFICATION_VERSION,
  ONTOLOGY_VERSION,
  OPPORTUNITY_METHOD_VERSION,
  QUESTION_METHOD_VERSION,
  SNAPSHOT_VERSION,
  THEMES,
  TREND_METHOD_VERSION
} from "./ontology.v3.mjs";
import { RESEARCH_PROFILE } from "../../site/assets/js/research.js";
import { buildQuestions } from "./questions.mjs";
import { buildResearchRadar, coverageFor } from "./radar.mjs";
import { catalogDocument } from "../../site/assets/js/catalog.js";
import { acceptedSemanticEntry } from "./semantic.mjs";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, filename.endsWith("search-index.json") ? undefined : 2)}\n`, "utf8");
  try {
    await rename(temporary, filename);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function immutableJson(filename, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(filename), { recursive: true });
  try {
    await writeFile(filename, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || await readFile(filename, "utf8") !== content) throw error;
  }
}

function analysisInput(works, calls) {
  return {
    works: [...works].sort((left, right) => left.id.localeCompare(right.id)).map((work) => ({
      id: work.id,
      recordType: work.recordType,
      title: work.title,
      abstract: work.abstract,
      publicationDate: work.publicationDate,
      firstPublicDate: work.firstPublicDate,
      authors: work.authors,
      venue: work.venue,
      topics: work.topics,
      keywords: work.keywords,
      versions: work.versions,
      discoveredBy: work.discoveredBy
    })),
    calls: [...(calls.items ?? [])].sort((left, right) => left.id.localeCompare(right.id)).map((call) => ({
      id: call.id,
      title: call.title,
      description: call.description,
      topics: call.topics,
      status: call.status,
      deadlineAt: call.deadlineAt,
      sourceKey: call.sourceKey,
      contentHash: call.contentHash
    })),
    callsStatus: calls.status
  };
}

function corpusIsComplete(meta) {
  // Completed requests are not scientific field coverage; changed queries break
  // comparability with historical generations. The new radar has window ledgers.
  if (meta.retrievalState) return false;
  if (meta.comparisonMode === "core" && meta.historicalBackfill) {
    return meta.historicalBackfill.complete === true && meta.ingestionProgress?.["openalex:core"]?.complete === true;
  }
  const incompleteCodes = new Set([
    "ingestion-modes-not-run",
    "ingestion-source-failed",
    "ingestion-source-partial",
    "stale-data-retained"
  ]);
  return meta.datasets?.publications?.status === "ready"
    && !meta.dataQualityWarnings?.some((warning) => incompleteCodes.has(warning.code));
}

function updateSearchIndex(searchIndex, works, generatedAt) {
  return {
    ...searchIndex,
    schemaVersion: "search-index-2.0.0",
    generatedAt,
    ontologyVersion: ONTOLOGY_VERSION,
    documents: works.map(catalogDocument),
    themeLabels: Object.fromEntries(THEMES.map(theme => [theme.id, theme.label]))
  };
}

function snapshotId(generatedAt, inputHash) {
  return `snapshot-${generatedAt.replaceAll(":", "-").replace(".", "-")}-${inputHash.slice(0, 10)}`;
}

function buildSnapshot({ generatedAt, inputHash, meta, metrics, questions, works, calls }) {
  const id = snapshotId(generatedAt, inputHash);
  const themeCounts = metrics.publicationTrends.map((trend) => ({
    theme: trend.theme,
    count: trend.totals.absoluteCount,
    journalCount: trend.totals.journalCount,
    preprintCount: trend.totals.preprintCount,
    proceedingsCount: trend.totals.proceedingsCount
  }));
  return {
    schemaVersion: "historical-snapshot-2.0.0",
    snapshotId: id,
    generatedAt,
    corpusGeneratedAt: meta.lastSuccessfulIngestionAt,
    inputHash,
    analysisVersion: ANALYSIS_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    queryVersion: meta.queryVersion,
    ontologyVersion: ONTOLOGY_VERSION,
    methodVersions: {
      trends: TREND_METHOD_VERSION,
      questions: QUESTION_METHOD_VERSION,
      opportunities: OPPORTUNITY_METHOD_VERSION,
      snapshot: SNAPSHOT_VERSION
    },
    coverage: metrics.coverage,
    totals: {
      found: works.length,
      analyzed: works.length,
      publications: works.filter((work) => work.recordType === "publication").length,
      preprints: works.filter((work) => work.recordType === "preprint").length,
      calls: calls.items?.length ?? 0,
      lensQuestions: questions.lens.length,
      dataDerivedQuestions: questions.dataDerived.length
    },
    sourceStatus: meta.sourceStatus,
    themeCounts,
    signals: metrics.publicationTrends.map((trend) => ({
      theme: trend.theme,
      publicationTrend: trend.status,
      emergingSignal: metrics.emergingSignals.find((entry) => entry.theme === trend.theme)?.status ?? "insufficient",
      agendaSignal: metrics.agendaSignals.find((entry) => entry.theme === trend.theme)?.status ?? "unavailable",
      opportunityStatus: metrics.opportunities.find((entry) => entry.theme === trend.theme)?.status ?? "insufficient",
      opportunityScore: metrics.opportunities.find((entry) => entry.theme === trend.theme)?.score ?? null,
      uncertainty: metrics.opportunities.find((entry) => entry.theme === trend.theme)?.uncertainty.level ?? "high"
    })),
    warnings: metrics.warnings
  };
}

function updateMeta(meta, generatedAt, metrics, questionData, snapshotCount, workCount) {
  const existingWarnings = (meta.dataQualityWarnings ?? []).filter((warning) => !warning.code.startsWith("analysis-"));
  const analysisWarnings = metrics.warnings.map((warning) => ({ ...warning, code: `analysis-${warning.code}` }));
  const baseMessage = String(meta.message).split(" Statische Analyse:")[0];
  const status = meta.status === "ready" && metrics.status === "ready" ? "ready" : "partial";
  return {
    ...meta,
    generatedAt,
    analysisVersion: ANALYSIS_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    status,
    totalAnalyzed: workCount,
    researchProfile: RESEARCH_PROFILE,
    message: `${baseMessage} Statische Analyse: ${workCount} reale Arbeiten klassifiziert; Trendvergleiche werden nur bei ausreichenden abgeschlossenen Zeitfenstern ausgewiesen.`,
    methodVersions: {
      analysis: ANALYSIS_VERSION,
      ontology: ONTOLOGY_VERSION,
      classification: CLASSIFICATION_VERSION,
      trends: TREND_METHOD_VERSION,
      questions: QUESTION_METHOD_VERSION,
      opportunities: OPPORTUNITY_METHOD_VERSION,
      snapshots: SNAPSHOT_VERSION
    },
    dataQualityWarnings: [...existingWarnings, ...analysisWarnings],
    datasets: {
      ...meta.datasets,
      trends: { ...meta.datasets.trends, status: metrics.status, recordCount: metrics.publicationTrends.length },
      questions: { ...meta.datasets.questions, status: metrics.status, recordCount: questionData.lens.length + questionData.dataDerived.length },
      snapshots: { ...meta.datasets.snapshots, status, recordCount: snapshotCount },
      searchIndex: { ...meta.datasets.searchIndex, status, recordCount: workCount }
    }
  };
}

export async function runAnalysisPipeline(options = {}) {
  const dataDirectory = path.resolve(options.dataDirectory ?? "site/data");
  const generatedAt = new Date(options.generatedAt ?? Date.now()).toISOString();
  const worksDirectory = path.join(dataDirectory, "works");
  const pageNames = (await readdir(worksDirectory)).filter((name) => /^page-\d+\.json$/.test(name)).sort();
  if (!pageNames.length) throw new Error("Keine paginierten Works-Dateien gefunden.");

  const [pages, calls, meta, searchIndex, previousSnapshotIndex] = await Promise.all([
    Promise.all(pageNames.map((name) => readJson(path.join(worksDirectory, name)))),
    readJson(path.join(dataDirectory, "calls.json")),
    readJson(path.join(dataDirectory, "meta.json")),
    readJson(path.join(dataDirectory, "search-index.json")),
    readJson(path.join(dataDirectory, "snapshots/index.json"))
  ]);
  const originalWorks = pages.flatMap((page, index) => page.items.map(work => ({
    ...work, firstSeenAt: work.firstSeenAt ?? work.retrievedAt,
    firstSeenRunId: work.firstSeenRunId ?? "legacy-import",
    pagePath: `./works/${pageNames[index]}`
  })));
  let inputHash = sha256(analysisInput(originalWorks, calls));
  const works = originalWorks.map(classifyWork);
  const semanticCache = await readJson(options.semanticCache ?? "analysis-cache/semantic.json").catch(error => { if (error.code === "ENOENT") return { entries: {} }; throw error; });
  const semanticEntries = {};
  for (const work of works) {
    const entry = acceptedSemanticEntry(work, semanticCache.entries?.[work.id]);
    if (entry) { semanticEntries[work.id] = entry; work.research.semantic = { model: entry.model, generatedAt: entry.generatedAt, ...entry.extraction }; }
  }
  inputHash = sha256({ corpus: inputHash, semanticEntries, retrievalState: meta.retrievalState ?? null, analysisVersion: ANALYSIS_VERSION });
  const metrics = buildStaticMetrics({
    generatedAt,
    works,
    calls,
    corpusComplete: corpusIsComplete(meta),
    comparisonMode: meta.comparisonMode
  });
  const questionData = buildQuestions(works.filter(work => work.research.relevance.status === "included"));
  const radar = buildResearchRadar(works, calls, meta, generatedAt, semanticEntries);
  // Retain old data contracts for historical snapshots, but retire unvalidated
  // combined scores and do not label incomplete comparisons as growing/cooling.
  for (const opportunity of metrics.opportunities) {
    opportunity.score = null; opportunity.status = "insufficient";
    opportunity.uncertainty = { level: "high", reasons: ["Gesamtscore zurückgezogen: keine validierte Gewichtung oder Prognosegüte. Siehe evidenzgebundene Projektideen."] };
  }
  if (!corpusIsComplete(meta)) {
    metrics.publicationTrends.forEach(trend => { trend.status = "insufficient"; });
    metrics.emergingSignals.forEach(signal => { signal.status = "insufficient"; });
  }
  const trends = {
    schemaVersion: "trends-2.0.0",
    generatedAt,
    status: metrics.status,
    snapshotVersion: SNAPSHOT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    inputHash,
    scope: "static-corpus",
    ...metrics
  };
  const questions = {
    schemaVersion: "questions-1.1.0",
    generatedAt,
    status: metrics.status,
    analysisVersion: ANALYSIS_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    inputHash,
    ...questionData
  };
  const snapshot = buildSnapshot({ generatedAt, inputHash, meta, metrics, questions, works, calls });
  const observationEnd = generatedAt.slice(0, 10);
  const observationStart = new Date(Date.parse(generatedAt) - 90 * 86400000).toISOString().slice(0, 10);
  snapshot.researchEvaluation = { queryVersion: meta.queryVersion, methodVersion: ANALYSIS_VERSION, coverageComplete: coverageFor(meta, "human-ai", observationStart, observationEnd).complete,
    themeCounts90: Object.fromEntries(THEMES.map(theme => [theme.id, works.filter(work => work.research.relevance.areas.includes("human-ai") && (work.firstPublicDate ?? work.publicationDate) >= observationStart && (work.firstPublicDate ?? work.publicationDate) <= observationEnd && work.classifiedThemes.some(t => t.theme === theme.id)).length])) };
  const snapshotName = `${snapshot.snapshotId}.json`;
  const snapshotEntry = {
    id: snapshot.snapshotId,
    generatedAt,
    path: `./${snapshotName}`,
    analysisVersion: ANALYSIS_VERSION,
    inputHash
  };
  const retainedEntries = (previousSnapshotIndex.snapshots ?? []).filter((entry) => entry.id !== snapshot.snapshotId);
  const snapshotIndex = {
    schemaVersion: "snapshots-index-1.1.0",
    generatedAt,
    snapshots: [...retainedEntries, snapshotEntry].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
  };
  const updatedMeta = updateMeta(meta, generatedAt, metrics, questions, snapshotIndex.snapshots.length, works.length);
  const updatedSearchIndex = updateSearchIndex(searchIndex, works, generatedAt);
  const shards = [];
  await mkdir(path.join(dataDirectory, "search"), { recursive: true });
  for (let offset = 0; offset < works.length; offset += 200) {
    const shardPath = `./search/shard-${String(shards.length + 1).padStart(3, "0")}.json`;
    const documents = works.slice(offset, offset + 200).map(work => ({ id: work.id, abstract: work.abstract, topics: work.topics, keywords: work.keywords }));
    await atomicJson(path.join(dataDirectory, shardPath), { schemaVersion: "search-shard-1.0.0", generatedAt, documents });
    shards.push({ path: shardPath, count: documents.length });
  }
  for (const name of await readdir(path.join(dataDirectory, "search"))) {
    if (/^shard-\d+\.json$/.test(name) && !shards.some(shard => shard.path === `./search/${name}`)) await unlink(path.join(dataDirectory, "search", name));
  }
  updatedSearchIndex.shards = shards;

  let workOffset = 0;
  const classifiedPages = pages.map((page) => {
    const items = works.slice(workOffset, workOffset + page.items.length);
    workOffset += page.items.length;
    return { ...page, generatedAt, items };
  });

  await immutableJson(path.join(dataDirectory, "snapshots", snapshotName), snapshot);
  await Promise.all([
    ...classifiedPages.map((page, index) => atomicJson(path.join(worksDirectory, pageNames[index]), page)),
    atomicJson(path.join(dataDirectory, "search-index.json"), updatedSearchIndex),
    atomicJson(path.join(dataDirectory, "trends.json"), trends),
    atomicJson(path.join(dataDirectory, "research-radar.json"), radar),
    atomicJson(path.join(dataDirectory, "questions.json"), questions),
    atomicJson(path.join(dataDirectory, "snapshots/index.json"), snapshotIndex),
    atomicJson(path.join(dataDirectory, "meta.json"), updatedMeta)
  ]);

  const classifiedCount = works.filter((work) => work.classifiedThemes.length).length;
  return {
    generatedAt,
    inputHash,
    status: metrics.status,
    totalWorks: works.length,
    classifiedWorks: classifiedCount,
    themeCounts: Object.fromEntries(THEMES.map((theme) => [theme.id, works.filter((work) => work.classifiedThemes.some((entry) => entry.theme === theme.id)).length])),
    supportedQuestions: questions.dataDerived.filter((question) => question.status === "supported").length,
    warnings: metrics.warnings,
    snapshot: `./snapshots/${snapshotName}`,
    files: [...pageNames.map((name) => `./works/${name}`), "./search-index.json", "./trends.json", "./questions.json", "./snapshots/index.json", "./meta.json", `./snapshots/${snapshotName}`]
  };
}
