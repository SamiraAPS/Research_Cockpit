import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ingestArxiv } from "./arxiv.mjs";
import {
  INGESTION_ANALYSIS_VERSION,
  META_SCHEMA_VERSION,
  ONTOLOGY_VERSION,
  OUTPUT_PAGE_SIZE,
  SEARCH_INDEX_SCHEMA_VERSION,
  SOURCE_HEALTH_SCHEMA_VERSION,
  STATIC_SEARCH_CONFIG_VERSION,
  WORKS_SCHEMA_VERSION,
  selectedModes
} from "./config.mjs";
import { enrichWithCrossref } from "./crossref.mjs";
import { deduplicateRecords, staticWorkToRecord } from "./deduplicate.mjs";
import { SourcePaginationError, ingestOpenAlex } from "./openalex.mjs";

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readExistingWorks(dataDirectory) {
  const worksDirectory = path.join(dataDirectory, "works");
  let entries = [];
  try {
    entries = await readdir(worksDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const pageNames = entries.filter((entry) => entry.isFile() && /^page-\d+\.json$/.test(entry.name)).map((entry) => entry.name).sort();
  const pages = await Promise.all(pageNames.map((name) => readJson(path.join(worksDirectory, name), { items: [] })));
  return pages.flatMap((page) => Array.isArray(page.items) ? page.items : []);
}

function providerOfStaticWork(work) {
  return work.externalIds?.arxiv || /arxiv/i.test(work.source?.name ?? "") ? "arxiv" : "openalex";
}

function oldRecordsForProvider(works, provider) {
  return works.filter((work) => providerOfStaticWork(work) === provider).length;
}

function existingHealthFor(previousHealth, source, modes) {
  const normalizedModes = [...modes].sort().join(",");
  return previousHealth.sources?.find((entry) =>
    entry.provider === source.toLowerCase() && [...(entry.modes ?? [])].sort().join(",") === normalizedModes
  ) ?? previousHealth.sources?.find((entry) => entry.provider === source.toLowerCase()) ?? null;
}

function sourceHealthEntry(stats, generatedAt, previousHealth, oldWorks) {
  let status = stats.status;
  if (status === "unavailable" && oldRecordsForProvider(oldWorks, stats.provider) > 0) status = "stale";
  const previous = existingHealthFor(previousHealth, stats.source, stats.modes);
  return {
    source: `${stats.source}${stats.modes.length ? ` (${stats.modes.join(", ")})` : ""}`,
    status,
    checkedAt: generatedAt,
    lastSuccessfulAt: status === "healthy" ? generatedAt : previous?.lastSuccessfulAt ?? null,
    recordCount: stats.recordCount,
    latencyMs: Number.isInteger(stats.latencyMs) ? stats.latencyMs : Math.round(stats.latencyMs ?? 0),
    message: stats.message,
    provider: stats.provider,
    role: stats.role,
    modes: stats.modes,
    queryVersions: stats.queryVersions,
    requestCount: stats.requestCount,
    pageCount: stats.pageCount,
    attempts: stats.attempts,
    retryCount: stats.retryCount,
    rateLimitEvents: stats.rateLimitEvents,
    httpStatus: stats.httpStatus,
    parameters: { ...stats.parameters, foundCount: stats.foundCount }
  };
}

function dataQualityWarnings(sourceEntries, incompleteModes, deduplication) {
  const warnings = [];
  for (const source of sourceEntries) {
    if (["degraded", "unavailable", "stale"].includes(source.status)) warnings.push({
      code: `ingestion-source-${source.status}`,
      severity: source.status === "unavailable" ? "error" : "warning",
      message: `${source.source}: ${source.message ?? source.status}`,
      affectedRecords: source.status === "stale" ? source.recordCount : 0
    });
  }
  if (incompleteModes.length > 0) warnings.push({
    code: "ingestion-modes-not-run",
    severity: "info",
    message: `Nicht ausgeführte Suchmodi: ${incompleteModes.join(", ")}.`,
    affectedRecords: 0
  });
  if (deduplication.mergedRecords > 0) warnings.push({
    code: "ingestion-deduplicated",
    severity: "info",
    message: `${deduplication.mergedRecords} Quellendatensätze wurden zu kanonischen Works zusammengeführt.`,
    affectedRecords: deduplication.mergedRecords
  });
  return warnings;
}

function datasetStatus(overallStatus) {
  return overallStatus === "ready" ? "ready" : overallStatus === "empty" ? "unavailable" : "partial";
}

async function writeJson(filename, value) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeWorksPages(dataDirectory, works, generatedAt, pageSize) {
  const worksDirectory = path.resolve(dataDirectory, "works");
  const resolvedData = path.resolve(dataDirectory);
  if (!worksDirectory.startsWith(`${resolvedData}${path.sep}`)) throw new Error("Unsicheres Works-Ausgabeverzeichnis");
  await mkdir(worksDirectory, { recursive: true });
  const chunks = [];
  for (let index = 0; index < works.length; index += pageSize) chunks.push(works.slice(index, index + pageSize));
  if (chunks.length === 0) chunks.push([]);
  const totalPages = works.length === 0 ? 0 : chunks.length;
  const desiredNames = new Set();
  for (let index = 0; index < chunks.length; index += 1) {
    const name = `page-${String(index + 1).padStart(3, "0")}.json`;
    desiredNames.add(name);
    await writeJson(path.join(worksDirectory, name), {
      schemaVersion: WORKS_SCHEMA_VERSION,
      generatedAt,
      page: index + 1,
      pageSize,
      totalItems: works.length,
      totalPages,
      nextPage: index + 1 < chunks.length ? `./page-${String(index + 2).padStart(3, "0")}.json` : null,
      items: chunks[index]
    });
  }

  const entries = await readdir(worksDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && /^page-\d+\.json$/.test(entry.name) && !desiredNames.has(entry.name)) {
      const obsolete = path.resolve(worksDirectory, entry.name);
      if (!obsolete.startsWith(`${worksDirectory}${path.sep}`)) throw new Error("Unsicherer veralteter Works-Pfad");
      await unlink(obsolete);
    }
  }
  return chunks.length;
}

function searchDocument(work) {
  return {
    id: work.id,
    recordType: work.recordType,
    title: work.title,
    abstract: work.abstract,
    authors: work.authors.map((author) => author.name),
    venue: work.venue,
    publicationDate: work.publicationDate,
    topics: work.topics,
    keywords: work.keywords,
    themes: work.classifiedThemes.map((classification) => classification.theme),
    evidenceTerms: work.evidenceTerms,
    url: work.url
  };
}

async function writeStaticOutputs(input) {
  const {
    dataDirectory,
    works,
    generatedAt,
    sourceEntries,
    modes,
    overallStatus,
    previousMeta,
    warnings,
    pageSize
  } = input;
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(path.join(dataDirectory, "snapshots"), { recursive: true });
  const pageCount = await writeWorksPages(dataDirectory, works, generatedAt, pageSize);
  await writeJson(path.join(dataDirectory, "search-index.json"), {
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    generatedAt,
    queryVersion: STATIC_SEARCH_CONFIG_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    documents: works.map(searchDocument)
  });

  const activeSources = sourceEntries.filter((source) => source.status !== "not_checked");
  const sourceHealthStatus = activeSources.length === 0
    ? "unavailable"
    : activeSources.every((source) => source.status === "healthy") ? "ready" : "partial";
  await writeJson(path.join(dataDirectory, "source-health.json"), {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    generatedAt,
    status: sourceHealthStatus,
    sources: sourceEntries
  });

  const publicationCount = works.filter((work) => work.recordType === "publication").length;
  const preprintCount = works.filter((work) => work.recordType === "preprint").length;
  const status = datasetStatus(overallStatus);
  const preservedDatasets = previousMeta.datasets ?? {};
  const datasets = {
    publications: { path: "./works/page-001.json", status, recordCount: publicationCount },
    preprints: { path: "./works/page-001.json", status, recordCount: preprintCount },
    searchIndex: { path: "./search-index.json", status, recordCount: works.length },
    calls: preservedDatasets.calls ?? { path: "./calls.json", status: "unavailable", recordCount: 0 },
    trends: preservedDatasets.trends ?? { path: "./trends.json", status: "unavailable", recordCount: 0 },
    questions: preservedDatasets.questions ?? { path: "./questions.json", status: "unavailable", recordCount: 0 },
    sourceHealth: { path: "./source-health.json", status: sourceHealthStatus, recordCount: sourceEntries.length },
    snapshots: preservedDatasets.snapshots ?? { path: "./snapshots/index.json", status: "unavailable", recordCount: 0 },
    ...(preservedDatasets.agendaSignals ? { agendaSignals: preservedDatasets.agendaSignals } : {})
  };
  const allDiscoveryHealthy = sourceEntries.filter((source) => source.role === "discovery").every((source) => source.status === "healthy");
  const requestedRunSuccessful = allDiscoveryHealthy && sourceEntries
    .filter((source) => source.role === "enrichment")
    .every((source) => ["healthy", "not_checked"].includes(source.status));
  const completeSnapshot = modes.length === 3 && requestedRunSuccessful;
  const lastSuccessfulIngestionAt = requestedRunSuccessful ? generatedAt : previousMeta.lastSuccessfulIngestionAt ?? null;
  const sourceStatus = sourceEntries.map((source) => ({
    source: source.source,
    status: source.status,
    recordCount: source.recordCount,
    checkedAt: source.checkedAt,
    message: source.message
  }));
  const previousWarnings = (previousMeta.dataQualityWarnings ?? []).filter((warning) => !String(warning.code).startsWith("ingestion-"));
  const message = overallStatus === "ready"
    ? "Statische Publikationsdaten vollständig aktualisiert."
    : requestedRunSuccessful
      ? "Ausgewählte Publikationsmodi erfolgreich aktualisiert; weitere Modi wurden nicht ausgeführt."
    : works.length > 0
      ? "Publikationsdaten teilweise aktualisiert; verifizierte Bestandsdaten wurden erhalten."
      : "Daten noch nicht verfügbar. Es werden keine Beispielinhalte oder Ersatzwerte angezeigt.";
  await writeJson(path.join(dataDirectory, "meta.json"), {
    schemaVersion: META_SCHEMA_VERSION,
    generatedAt,
    lastSuccessfulIngestionAt,
    analysisVersion: INGESTION_ANALYSIS_VERSION,
    queryVersion: STATIC_SEARCH_CONFIG_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    mode: completeSnapshot ? "snapshot" : "incremental",
    status: overallStatus,
    totalFound: works.length,
    totalAnalyzed: works.length,
    message,
    sourceStatus,
    dataQualityWarnings: [...previousWarnings, ...warnings],
    datasets
  });
  return { pageCount, publicationCount, preprintCount };
}

export async function runStaticIngestion(options = {}) {
  const dataDirectory = path.resolve(options.dataDirectory ?? "site/data");
  const generatedAt = options.now?.toISOString?.() ?? new Date().toISOString();
  const modes = selectedModes(options.mode ?? "all");
  const runId = `ingestion-${generatedAt}`;
  const previousMeta = await readJson(path.join(dataDirectory, "meta.json"), {});
  const previousHealth = await readJson(path.join(dataDirectory, "source-health.json"), { sources: [] });
  const oldWorks = await readExistingWorks(dataDirectory);
  const freshRecords = [];
  const sourceStats = [];

  function resumed(provider, mode) {
    const previous = previousMeta.ingestionProgress?.[`${provider}:${mode}`];
    return options.resume && previous && (previous.cursor || previous.start)
      ? { ...options, range: previous.range, cursor: previous.cursor, start: previous.start }
      : options;
  }
  for (const mode of modes) {
    try {
      const result = await ingestOpenAlex(mode, resumed("openalex", mode));
      freshRecords.push(...result.records);
      sourceStats.push(result.stats);
    } catch (error) {
      if (!(error instanceof SourcePaginationError)) throw error;
      freshRecords.push(...error.partialRecords);
      sourceStats.push(error.stats);
    }
  }

  if (modes.includes("frontier")) {
    try {
      const result = await ingestArxiv(resumed("arxiv", "frontier"));
      freshRecords.push(...result.records);
      sourceStats.push(result.stats);
    } catch (error) {
      if (!(error instanceof SourcePaginationError)) throw error;
      freshRecords.push(...error.partialRecords);
      sourceStats.push(error.stats);
    }
  }

  const crossref = await enrichWithCrossref(freshRecords, {
    ...options,
    disabled: options.crossref === false
  });
  sourceStats.push(crossref.stats);
  const discoveryByProvider = new Map();
  for (const stats of sourceStats.filter((stats) => stats.role === "discovery")) {
    const statuses = discoveryByProvider.get(stats.provider) ?? [];
    statuses.push(stats.status);
    discoveryByProvider.set(stats.provider, statuses);
  }
  const failedProviders = new Set([...discoveryByProvider.entries()].filter(([, statuses]) =>
    statuses.every((status) => status === "unavailable")
  ).map(([provider]) => provider));
  const existingRecords = oldWorks.map(staticWorkToRecord);
  const deduplicated = deduplicateRecords([...crossref.records, ...existingRecords], { generatedAt, failedProviders, runId });
  const sourceEntries = sourceStats.map((stats) => sourceHealthEntry(stats, generatedAt, previousHealth, oldWorks));
  const incompleteModes = ["core", "broad", "frontier"].filter((mode) => !modes.includes(mode));
  const sourceIssues = sourceEntries.some((source) => ["degraded", "unavailable", "stale"].includes(source.status));
  const overallStatus = deduplicated.works.length === 0 && sourceIssues
    ? "empty"
    : sourceIssues || incompleteModes.length > 0 ? "partial" : "ready";
  const warnings = dataQualityWarnings(sourceEntries, incompleteModes, deduplicated.stats);
  const output = await writeStaticOutputs({
    dataDirectory,
    works: deduplicated.works,
    generatedAt,
    sourceEntries,
    modes,
    overallStatus,
    previousMeta,
    warnings,
    pageSize: options.pageSize ?? OUTPUT_PAGE_SIZE
  });

  const metaFile = path.join(dataDirectory, "meta.json");
  const meta = await readJson(metaFile, {});
  meta.lastIngestionRunId = runId;
  meta.lastIngestionAt = generatedAt;
  meta.comparisonMode = previousMeta.comparisonMode ?? options.comparisonMode ?? "core";
  if (previousMeta.historicalBackfill) meta.historicalBackfill = previousMeta.historicalBackfill;
  meta.coverageHistory = [...(previousMeta.coverageHistory ?? []), ...sourceStats.filter(s => s.role === "discovery").map(s => ({
    provider: s.provider, mode: s.modes[0], from: s.parameters.fromDate, to: s.parameters.toDate,
    found: s.foundCount, retrieved: s.recordCount, complete: s.status === "healthy", checkedAt: generatedAt
  }))].slice(-120);
  meta.ingestionProgress = { ...(previousMeta.ingestionProgress ?? {}) };
  for (const stats of sourceStats.filter(s => s.role === "discovery")) {
    const key = `${stats.provider}:${stats.modes[0]}`;
    const prior = options.resume ? previousMeta.ingestionProgress?.[key] : null;
    meta.ingestionProgress[key] = {
      range: { from: stats.parameters.fromDate, to: stats.parameters.toDate },
      cursor: stats.parameters.nextCursor ?? (stats.status === "unavailable" ? prior?.cursor ?? null : null),
      start: stats.parameters.nextStart ?? (stats.status === "unavailable" ? prior?.start ?? null : null),
      retrieved: (prior?.cursor || prior?.start ? prior.retrieved : 0) + stats.recordCount,
      found: stats.foundCount, complete: stats.status === "healthy"
    };
  }
  await writeJson(metaFile, meta);
  return {
    generatedAt,
    mode: options.mode ?? "all",
    modes,
    status: overallStatus,
    sources: sourceEntries,
    queries: sourceStats.map((stats) => ({
      source: stats.source,
      role: stats.role,
      modes: stats.modes,
      queryVersions: stats.queryVersions,
      parameters: { ...stats.parameters, foundCount: stats.foundCount }
    })),
    pagination: sourceStats.map((stats) => ({
      source: stats.source,
      modes: stats.modes,
      pages: stats.pageCount,
      requests: stats.requestCount,
      attempts: stats.attempts,
      retries: stats.retryCount,
      rateLimitEvents: stats.rateLimitEvents
    })),
    counts: {
      rawFoundBySources: sourceStats.filter((stats) => stats.role === "discovery").reduce((sum, stats) => sum + stats.foundCount, 0),
      retrievedThisRun: crossref.records.length,
      retainedFromPreviousRun: oldWorks.length,
      canonicalWorks: deduplicated.works.length,
      analyzed: deduplicated.works.length,
      publications: output.publicationCount,
      preprints: output.preprintCount
    },
    deduplication: deduplicated.stats,
    output: {
      dataDirectory,
      worksPages: output.pageCount,
      files: ["meta.json", "search-index.json", "source-health.json", "works/page-*.json"]
    }
  };
}
