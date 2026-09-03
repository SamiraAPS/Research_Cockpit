import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { fetchWithRetry, SourceRequestError } from "../ingestion/http.mjs";
import { parseOfficialCallSource, ParserContractError } from "./adapters/index.mjs";
import { sha256 } from "./adapters/shared.mjs";
import {
  AGENDA_SIGNALS_SCHEMA_VERSION, CALLS_REGISTRY_VERSION, CALLS_SCHEMA_VERSION, OFFICIAL_CALL_SOURCES,
  selectOfficialCallSources
} from "./config.mjs";
import { mergeCalls } from "./merge.mjs";

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filename);
}

function validateRegistryUrl(source) {
  const url = new URL(source.officialUrl);
  if (url.protocol !== "https:" || !source.allowedHosts.includes(url.hostname)) {
    throw new ParserContractError(source.key, "Registry-URL liegt nicht auf einem freigegebenen offiziellen Host");
  }
  return url;
}

function sourceError(error) {
  if (error instanceof SourceRequestError) {
    return {
      status: error.httpStatus === 403 ? "forbidden" : "unavailable",
      httpStatus: error.httpStatus,
      attempts: error.attempts,
      latencyMs: error.latencyMs,
      rateLimitEvents: error.rateLimitEvents,
      message: error.message
    };
  }
  return {
    status: "parser_error",
    httpStatus: null,
    attempts: 1,
    latencyMs: 0,
    rateLimitEvents: 0,
    message: error instanceof Error ? error.message : "Unbekannter Parserfehler"
  };
}

async function ingestSource(source, options, generatedAt, previousStatus) {
  const started = Date.now();
  let fetched = null;
  try {
    fetched = await fetchWithRetry(validateRegistryUrl(source), {
      source: source.name,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      timeoutMs: options.timeoutMs ?? 20_000,
      maxAttempts: options.maxAttempts ?? 3,
      baseDelayMs: options.baseDelayMs ?? 750,
      init: {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "HumanAIResearchRadar-Calls/2.0 (research data pipeline)"
        }
      }
    });
    const contentType = fetched.response.headers.get("content-type");
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new ParserContractError(source.key, `Unerwarteter Content-Type: ${contentType}`);
    }
    const html = await fetched.response.text();
    const parsed = parseOfficialCallSource(source, html);
    const sourceContentHash = sha256({
      markers: parsed.structureMarkers,
      calls: parsed.calls,
      agendaSignals: parsed.agendaSignals
    });
    return {
      checked: true,
      source,
      status: "verified",
      checkedAt: generatedAt,
      lastVerifiedAt: generatedAt,
      httpStatus: fetched.response.status,
      foundCount: parsed.calls.length,
      agendaSignalCount: parsed.agendaSignals.length,
      attempts: fetched.attempts,
      latencyMs: fetched.latencyMs,
      rateLimitEvents: fetched.rateLimitEvents,
      message: previousStatus?.sourceContentHash && previousStatus.sourceContentHash !== sourceContentHash
        ? "Offizieller Inhalt wurde geändert; Versionshistorie aktualisiert."
        : null,
      sourceContentHash,
      calls: parsed.calls.map((call) => ({
        ...call,
        parserVersion: source.parserVersion,
        sourceVersion: source.sourceVersion,
        sourceKey: source.key,
        sourceName: source.name
      })),
      agendaSignals: parsed.agendaSignals
    };
  } catch (error) {
    const details = sourceError(error);
    if (fetched && details.status === "parser_error") {
      details.httpStatus = fetched.response.status;
      details.attempts = fetched.attempts;
      details.latencyMs = fetched.latencyMs;
      details.rateLimitEvents = fetched.rateLimitEvents;
    }
    return {
      checked: true,
      source,
      ...details,
      checkedAt: generatedAt,
      lastVerifiedAt: previousStatus?.lastVerifiedAt ?? null,
      foundCount: 0,
      agendaSignalCount: 0,
      sourceContentHash: previousStatus?.sourceContentHash ?? null,
      calls: [],
      agendaSignals: [],
      latencyMs: details.latencyMs || Date.now() - started
    };
  }
}

async function mapWithConcurrency(values, concurrency, callback) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function publicSourceStatus(result) {
  const source = result.source;
  return {
    sourceKey: source.key,
    sourceName: source.name,
    officialUrl: source.officialUrl,
    status: result.status,
    checkedAt: result.checkedAt,
    lastVerifiedAt: result.lastVerifiedAt,
    httpStatus: result.httpStatus ?? null,
    foundCount: result.foundCount ?? 0,
    agendaSignalCount: result.agendaSignalCount ?? 0,
    attempts: result.attempts ?? 0,
    latencyMs: Math.max(0, Math.round(result.latencyMs ?? 0)),
    rateLimitEvents: result.rateLimitEvents ?? 0,
    message: result.message ?? null,
    parserVersion: source.parserVersion,
    sourceVersion: source.sourceVersion,
    sourceContentHash: result.sourceContentHash ?? null
  };
}

function sourceResultMap(results) {
  return new Map(results.map((result) => [result.source.key, result]));
}

function datasetStatus(results, itemCount, allSourcesSelected) {
  if (allSourcesSelected && results.every((result) => result.status === "verified")) return "ready";
  if (itemCount > 0 || results.some((result) => result.status === "verified")) return "partial";
  return "unavailable";
}

function mergeAgenda(previous, results, selectedKeys, generatedAt) {
  const freshBySource = new Map(results.filter((result) => result.status === "verified").map((result) => [result.source.key, result]));
  const previousBySource = new Map((previous.items ?? []).map((entry) => [entry.sourceKey, entry]));
  return OFFICIAL_CALL_SOURCES.flatMap((source) => {
    const fresh = freshBySource.get(source.key);
    if (fresh) return [{
      sourceKey: source.key,
      sourceName: source.name,
      officialUrl: source.officialUrl,
      capturedAt: generatedAt,
      parserVersion: source.parserVersion,
      sourceVersion: source.sourceVersion,
      sourceContentHash: fresh.sourceContentHash,
      dataStatus: "verified",
      signals: fresh.agendaSignals
    }];
    const old = previousBySource.get(source.key);
    if (!old) return [];
    return [{ ...old, dataStatus: selectedKeys.has(source.key) ? "stale" : old.dataStatus }];
  });
}

function updateMeta(previousMeta, callsStatus, callCount, agendaStatus, agendaSignalCount, sourceStatuses, generatedAt) {
  const partialSuffix = "Calls sind teilweise verfügbar; Fehler werden quellengenau ausgewiesen.";
  const baseMessage = String(previousMeta.message ?? "").replace(new RegExp(`(?:\\s*${partialSuffix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})+$`), "").trim();
  const oldWarnings = (previousMeta.dataQualityWarnings ?? []).filter((warning) => !String(warning.code).startsWith("calls-source-"));
  const warnings = sourceStatuses.filter((source) => source.status !== "verified").map((source) => ({
    code: `calls-source-${source.status}-${source.sourceKey}`,
    severity: source.status === "forbidden" || source.status === "unavailable" ? "warning" : "error",
    message: `${source.sourceName}: ${source.message ?? source.status}`,
    affectedRecords: 0
  }));
  const datasets = {
    ...(previousMeta.datasets ?? {}),
    calls: { path: "./calls.json", status: callsStatus, recordCount: callCount },
    agendaSignals: { path: "./agenda-signals.json", status: agendaStatus, recordCount: agendaSignalCount }
  };
  return {
    ...previousMeta,
    generatedAt,
    status: previousMeta.status === "empty" && callCount === 0 ? "empty" : callsStatus === "ready" ? previousMeta.status : "partial",
    message: callsStatus === "ready"
      ? baseMessage
      : `${baseMessage} ${partialSuffix}`.trim(),
    dataQualityWarnings: [...oldWarnings, ...warnings],
    datasets
  };
}

export async function runCallsIngestion(options = {}) {
  const dataDirectory = path.resolve(options.dataDirectory ?? "site/data");
  const generatedAt = options.now?.toISOString?.() ?? new Date().toISOString();
  const sources = selectOfficialCallSources(options.sourceKeys ?? []);
  const selectedKeys = new Set(sources.map((source) => source.key));
  await mkdir(dataDirectory, { recursive: true });
  const [previousCalls, previousAgenda, previousMeta] = await Promise.all([
    readJson(path.join(dataDirectory, "calls.json"), { sourceStatus: [], items: [] }),
    readJson(path.join(dataDirectory, "agenda-signals.json"), { items: [] }),
    readJson(path.join(dataDirectory, "meta.json"), {})
  ]);
  const previousStatusByKey = new Map((previousCalls.sourceStatus ?? []).map((entry) => [entry.sourceKey, entry]));
  const results = await mapWithConcurrency(sources, options.concurrency ?? 3, (source) =>
    ingestSource(source, options, generatedAt, previousStatusByKey.get(source.key))
  );
  const resultByKey = sourceResultMap(results);
  const oldStatusByKey = new Map((previousCalls.sourceStatus ?? []).map((entry) => [entry.sourceKey, entry]));
  const sourceStatuses = OFFICIAL_CALL_SOURCES.map((source) => {
    const current = resultByKey.get(source.key);
    if (current) return publicSourceStatus(current);
    return oldStatusByKey.get(source.key) ?? {
      sourceKey: source.key,
      sourceName: source.name,
      officialUrl: source.officialUrl,
      status: "not_checked",
      checkedAt: null,
      lastVerifiedAt: null,
      httpStatus: null,
      foundCount: 0,
      agendaSignalCount: 0,
      attempts: 0,
      latencyMs: 0,
      rateLimitEvents: 0,
      message: "In diesem Lauf nicht geprüft.",
      parserVersion: source.parserVersion,
      sourceVersion: source.sourceVersion,
      sourceContentHash: null
    };
  });
  const freshCalls = results.flatMap((result) => result.calls);
  const merged = mergeCalls(previousCalls.items ?? [], freshCalls, resultByKey, generatedAt);
  const allSourcesSelected = selectedKeys.size === OFFICIAL_CALL_SOURCES.length;
  const callsStatus = datasetStatus(results, merged.items.length, allSourcesSelected);
  const calls = {
    schemaVersion: CALLS_SCHEMA_VERSION,
    generatedAt,
    status: callsStatus,
    registryVersion: CALLS_REGISTRY_VERSION,
    closingWindowDays: 30,
    counts: {
      totalStored: merged.items.length,
      active: merged.items.filter((call) => call.status === "open" || call.status === "closing-soon").length,
      open: merged.items.filter((call) => call.status === "open").length,
      closingSoon: merged.items.filter((call) => call.status === "closing-soon").length,
      expired: merged.items.filter((call) => call.status === "expired").length,
      unverified: merged.items.filter((call) => call.status === "unverified").length
    },
    sourceStatus: sourceStatuses,
    items: merged.items
  };
  const agendaItems = mergeAgenda(previousAgenda, results, selectedKeys, generatedAt);
  const agendaSignalCount = agendaItems.reduce((sum, entry) => sum + entry.signals.length, 0);
  const agendaStatus = datasetStatus(results, agendaSignalCount, allSourcesSelected);
  const agenda = {
    schemaVersion: AGENDA_SIGNALS_SCHEMA_VERSION,
    generatedAt,
    status: agendaStatus,
    registryVersion: CALLS_REGISTRY_VERSION,
    interpretation: "Rohsignale aus offiziellen Call-Seiten; keine Publikationstrends und keine wissenschaftliche Evidenz.",
    items: agendaItems
  };
  const meta = updateMeta(previousMeta, callsStatus, calls.items.length, agendaStatus, agendaSignalCount, sourceStatuses, generatedAt);
  await Promise.all([
    writeJsonAtomic(path.join(dataDirectory, "calls.json"), calls),
    writeJsonAtomic(path.join(dataDirectory, "agenda-signals.json"), agenda),
    writeJsonAtomic(path.join(dataDirectory, "meta.json"), meta)
  ]);
  return {
    generatedAt,
    status: callsStatus,
    registryVersion: CALLS_REGISTRY_VERSION,
    sources: sourceStatuses.filter((source) => selectedKeys.has(source.sourceKey)),
    counts: { ...calls.counts, ...merged.stats, agendaSignals: agendaSignalCount },
    output: {
      dataDirectory,
      files: ["calls.json", "agenda-signals.json", "meta.json"]
    }
  };
}
