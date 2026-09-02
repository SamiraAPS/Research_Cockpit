import type { D1DatabaseLike } from "@/db/d1";
import { paginateArxiv } from "./arxiv";
import {
  CROSSREF_ENRICHMENT_LIMIT,
  DEFAULT_INGESTION_SAFETY_LIMIT,
  MAX_INGESTION_SAFETY_LIMIT,
  QUERY_VERSIONS,
  type SearchLayer,
} from "./config/search.v3";
import { enrichWithCrossref } from "./crossref";
import { SourceRequestError } from "./http";
import { buildTrendUrl, buildWorksUrl, fetchOpenAlex, normalizeOpenAlexWork, paginateOpenAlex } from "./openalex";
import {
  createIngestionRun,
  ensureIngestionSource,
  finishIngestionRun,
  insertTrendSnapshots,
  persistWork,
  recordSourceHealth,
  type IngestionStatus,
} from "./repository";
import { createThemeSignalSnapshots } from "./trend-repository";
import type { IngestibleWork, WorkProvider } from "./work";

export type LayerIngestionRequest = {
  layer: SearchLayer;
  scope: "ai" | "field";
  safetyLimit?: number;
};

export type IngestionRequest =
  | LayerIngestionRequest
  | { dataset: "trends"; scope?: "all" }
  // Kept as a compatibility bridge for the Block-2 manual command and tests.
  | { dataset: "publications" | "preprints"; scope: "ai" | "field"; safetyLimit?: number };

export type SourceIngestionStatus = {
  provider: "openalex" | "arxiv" | "crossref";
  role: "discovery" | "enrichment";
  status: "healthy" | "degraded" | "unavailable";
  httpStatus: number | null;
  attempts: number;
  message: string | null;
};

export type IngestionSummary = {
  runId: string;
  runIds: string[];
  provider: WorkProvider | "openalex-trends" | "multiple";
  layer: SearchLayer | "trends";
  status: Exclude<IngestionStatus, "running">;
  foundCount: number;
  loadedCount: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  safetyLimit: number;
  limitReached: boolean;
  pageCount: number;
  sourceStatuses: SourceIngestionStatus[];
};

type IngestionOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
  days?: number;
  safetyLimit?: number;
  openAlexApiKey?: string;
  crossrefMailto?: string;
  crossrefLimit?: number;
};

type ProviderResult = IngestionSummary & { provider: WorkProvider };

function errorDetails(error: unknown) {
  if (error instanceof SourceRequestError) {
    return {
      message: error.message,
      latencyMs: error.latencyMs,
      httpStatus: error.httpStatus,
      attempts: error.attempts,
    };
  }
  return {
    message: error instanceof Error ? error.message : "Unknown ingestion error",
    latencyMs: null,
    httpStatus: null,
    attempts: 1,
  };
}

function safetyLimit(requested?: number) {
  const value = requested ?? DEFAULT_INGESTION_SAFETY_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INGESTION_SAFETY_LIMIT) {
    throw new Error(`safetyLimit must be an integer between 1 and ${MAX_INGESTION_SAFETY_LIMIT}`);
  }
  return value;
}

function sourceStatus(
  provider: SourceIngestionStatus["provider"],
  role: SourceIngestionStatus["role"],
  status: SourceIngestionStatus["status"],
  input: { httpStatus?: number | null; attempts?: number; message?: string | null } = {},
): SourceIngestionStatus {
  return {
    provider,
    role,
    status,
    httpStatus: input.httpStatus ?? null,
    attempts: input.attempts ?? 0,
    message: input.message ?? null,
  };
}

async function maybeEnrich(
  work: IngestibleWork,
  context: {
    remaining: number;
    options: IngestionOptions;
    stats: { attempted: number; succeeded: number; failed: number; latencyMs: number; attempts: number; httpStatus: number | null; errors: string[] };
  },
) {
  const needsMetadata = !work.abstract || work.authors.length === 0 || !work.onlineDate;
  if (!work.doiNormalized || !needsMetadata || context.remaining <= 0) return work;
  context.stats.attempted += 1;
  try {
    const enriched = await enrichWithCrossref(work, {
      fetchImpl: context.options.fetchImpl,
      sleep: context.options.sleep,
      mailto: context.options.crossrefMailto,
    });
    context.stats.succeeded += 1;
    context.stats.latencyMs += enriched.latencyMs;
    context.stats.attempts += enriched.attempts;
    context.stats.httpStatus = enriched.httpStatus;
    return enriched.work;
  } catch (error) {
    const details = errorDetails(error);
    context.stats.failed += 1;
    context.stats.latencyMs += details.latencyMs ?? 0;
    context.stats.attempts += details.attempts;
    context.stats.httpStatus = details.httpStatus;
    context.stats.errors.push(details.message);
    return work;
  }
}

async function recordCrossrefHealth(
  db: D1DatabaseLike,
  runId: string,
  checkedAt: string,
  stats: { attempted: number; succeeded: number; failed: number; latencyMs: number; attempts: number; httpStatus: number | null; errors: string[] },
) {
  if (stats.attempted === 0) return null;
  const sourceId = await ensureIngestionSource(db, "frontier", checkedAt, "crossref");
  const status = stats.failed === 0 ? "healthy" : stats.succeeded > 0 ? "degraded" : "unavailable";
  const message = stats.errors.length ? [...new Set(stats.errors)].slice(0, 3).join("; ") : null;
  await recordSourceHealth(db, {
    sourceId,
    ingestionRunId: runId,
    checkName: "doi-metadata-enrichment",
    status,
    latencyMs: stats.latencyMs,
    httpStatus: stats.httpStatus,
    errorMessage: message,
    checkedAt,
  });
  return sourceStatus("crossref", "enrichment", status, {
    httpStatus: stats.httpStatus,
    attempts: stats.attempts,
    message,
  });
}

async function ingestProvider(
  db: D1DatabaseLike,
  provider: WorkProvider,
  request: LayerIngestionRequest,
  options: IngestionOptions,
): Promise<ProviderResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const limit = safetyLimit(request.safetyLimit ?? options.safetyLimit);
  const queryVersion = QUERY_VERSIONS[request.layer];
  const sourceId = await ensureIngestionSource(db, request.layer, startedAt, provider);
  const ingestionRun = await createIngestionRun(db, {
    sourceId,
    scope: request.scope,
    searchLayer: request.layer,
    queryVersion,
    safetyLimit: limit,
    startedAt,
  });
  const base: Omit<ProviderResult, "status" | "foundCount" | "loadedCount" | "newCount" | "updatedCount" | "errorCount" | "limitReached" | "pageCount" | "sourceStatuses"> = {
    runId: ingestionRun.id,
    runIds: [ingestionRun.id],
    provider,
    layer: request.layer,
    safetyLimit: limit,
  };

  try {
    let retrieval: {
      foundCount: number;
      pageCount: number;
      limitReached: boolean;
      latencyMs: number;
      attempts: number;
      httpStatus: number;
    };
    let records: IngestibleWork[];
    if (provider === "openalex") {
      const result = await paginateOpenAlex(buildWorksUrl(request.layer, options.days ?? 90, request.scope), limit, {
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        apiKey: options.openAlexApiKey,
      });
      retrieval = result;
      const retrievedAt = now();
      records = result.records.map((record) => normalizeOpenAlexWork(record, retrievedAt));
    } else {
      const result = await paginateArxiv(options.days ?? 90, request.scope, limit, {
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
      });
      retrieval = result;
      const retrievedAt = now();
      records = result.records.map((record) => ({ ...record, retrievedAt }));
    }
    let newCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const crossrefStats = { attempted: 0, succeeded: 0, failed: 0, latencyMs: 0, attempts: 0, httpStatus: null as number | null, errors: [] as string[] };
    const crossrefLimit = Math.max(0, options.crossrefLimit ?? CROSSREF_ENRICHMENT_LIMIT);

    for (const record of records) {
      try {
        const enriched = await maybeEnrich(record, {
          remaining: crossrefLimit - crossrefStats.attempted,
          options,
          stats: crossrefStats,
        });
        const saved = await persistWork(db, enriched, {
          ingestionRunId: ingestionRun.id,
          scope: request.scope,
          searchLayer: request.layer,
          queryVersion,
        });
        if (saved.isNew) newCount += 1;
        else if (saved.updated) updatedCount += 1;
      } catch (error) {
        errorCount += 1;
        errors.push(error instanceof Error ? error.message : "Record persistence failed");
      }
    }

    const limitMessage = retrieval.limitReached
      ? `Configured safety limit of ${limit} records was reached; more source records are available.`
      : null;
    if (limitMessage) errors.push(limitMessage);
    const status: ProviderResult["status"] = errorCount > 0 || retrieval.limitReached ? "partial" : "succeeded";
    const endedAt = now();
    const errorMessage = errors.length ? [...new Set(errors)].slice(0, 5).join("; ") : null;
    await finishIngestionRun(db, {
      id: ingestionRun.id,
      status,
      foundCount: retrieval.foundCount,
      loadedCount: records.length,
      newCount,
      updatedCount,
      errorCount,
      errorMessage,
      limitReached: retrieval.limitReached,
      endedAt,
    });
    const discoveryStatus = status === "succeeded" ? "healthy" : "degraded";
    await recordSourceHealth(db, {
      sourceId,
      ingestionRunId: ingestionRun.id,
      checkName: `cursor-pagination:${retrieval.pageCount}-pages`,
      status: discoveryStatus,
      latencyMs: retrieval.latencyMs,
      httpStatus: retrieval.httpStatus,
      errorMessage,
      checkedAt: endedAt,
    });
    const crossref = await recordCrossrefHealth(db, ingestionRun.id, endedAt, crossrefStats);
    return {
      ...base,
      status,
      foundCount: retrieval.foundCount,
      loadedCount: records.length,
      newCount,
      updatedCount,
      errorCount,
      limitReached: retrieval.limitReached,
      pageCount: retrieval.pageCount,
      sourceStatuses: [
        sourceStatus(provider, "discovery", discoveryStatus, {
          httpStatus: retrieval.httpStatus,
          attempts: retrieval.attempts,
          message: errorMessage,
        }),
        ...(crossref ? [crossref] : []),
      ],
    };
  } catch (error) {
    const details = errorDetails(error);
    const endedAt = now();
    await finishIngestionRun(db, {
      id: ingestionRun.id,
      status: "failed",
      foundCount: 0,
      loadedCount: 0,
      newCount: 0,
      updatedCount: 0,
      errorCount: 1,
      errorMessage: details.message,
      endedAt,
    });
    await recordSourceHealth(db, {
      sourceId,
      ingestionRunId: ingestionRun.id,
      checkName: "source-request",
      status: "unavailable",
      latencyMs: details.latencyMs,
      httpStatus: details.httpStatus,
      errorMessage: details.message,
      checkedAt: endedAt,
    });
    return {
      ...base,
      status: "failed",
      foundCount: 0,
      loadedCount: 0,
      newCount: 0,
      updatedCount: 0,
      errorCount: 1,
      limitReached: false,
      pageCount: 0,
      sourceStatuses: [sourceStatus(provider, "discovery", "unavailable", {
        httpStatus: details.httpStatus,
        attempts: details.attempts,
        message: details.message,
      })],
    };
  }
}

function combinedStatus(results: ProviderResult[]): IngestionSummary["status"] {
  if (results.every((result) => result.status === "failed")) return "failed";
  if (results.every((result) => result.status === "succeeded")) return "succeeded";
  return "partial";
}

function combine(results: ProviderResult[]): IngestionSummary {
  const first = results[0];
  return {
    runId: first.runId,
    runIds: results.map((result) => result.runId),
    provider: results.length === 1 ? first.provider : "multiple",
    layer: first.layer,
    status: combinedStatus(results),
    foundCount: results.reduce((sum, result) => sum + result.foundCount, 0),
    loadedCount: results.reduce((sum, result) => sum + result.loadedCount, 0),
    newCount: results.reduce((sum, result) => sum + result.newCount, 0),
    updatedCount: results.reduce((sum, result) => sum + result.updatedCount, 0),
    errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
    safetyLimit: results.reduce((sum, result) => sum + result.safetyLimit, 0),
    limitReached: results.some((result) => result.limitReached),
    pageCount: results.reduce((sum, result) => sum + result.pageCount, 0),
    sourceStatuses: results.flatMap((result) => result.sourceStatuses),
  };
}

function trendGroups(payload: { group_by?: Array<{ key?: string | number; count?: number }> }) {
  return (payload.group_by ?? []).flatMap((group) => {
    const year = Number(group.key);
    const count = Number(group.count);
    return Number.isSafeInteger(year) && Number.isSafeInteger(count) ? [{ year, count }] : [];
  });
}

async function ingestTrends(db: D1DatabaseLike, options: IngestionOptions): Promise<IngestionSummary> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const sourceId = await ensureIngestionSource(db, "trends", startedAt);
  const run = await createIngestionRun(db, {
    sourceId,
    scope: "all",
    searchLayer: "trends",
    queryVersion: QUERY_VERSIONS.trends,
    safetyLimit: 4,
    startedAt,
  });
  const successes: Array<Awaited<ReturnType<typeof fetchOpenAlex>> & { scope: "ai" | "field"; groups: Array<{ year: number; count: number }> }> = [];
  const failures: ReturnType<typeof errorDetails>[] = [];
  for (const scope of ["ai", "field"] as const) {
    for (const type of ["article", "preprint"] as const) {
      try {
        const fetched = await fetchOpenAlex(buildTrendUrl(type, scope), "group_by", {
          fetchImpl: options.fetchImpl,
          sleep: options.sleep,
          apiKey: options.openAlexApiKey,
        });
        const groups = trendGroups(fetched.payload);
        // D1 batches are serialized so local adapters and remote D1 observe the same transaction order.
        await insertTrendSnapshots(db, {
          ingestionRunId: run.id,
          sourceId,
          scope,
          publicationType: type,
          groups,
          capturedAt: now(),
          queryVersion: QUERY_VERSIONS.trends,
        });
        successes.push({ ...fetched, scope, groups });
      } catch (error) {
        failures.push(errorDetails(error));
      }
    }
  }
  const endedAt = now();
  let analysisError: string | null = null;
  try {
    await createThemeSignalSnapshots(db, { ingestionRunId: run.id, capturedAt: endedAt });
  } catch (error) {
    analysisError = error instanceof Error ? error.message : "Theme signal snapshot failed";
  }
  const status: IngestionSummary["status"] = successes.length === 4 && !analysisError ? "succeeded" : successes.length ? "partial" : "failed";
  const foundCount = successes.reduce((sum, result) => sum + (result.payload.meta?.count ?? 0), 0);
  const loadedCount = successes.reduce((sum, result) => sum + result.groups.length, 0);
  const messageParts = [...failures.map((failure) => failure.message), ...(analysisError ? [analysisError] : [])];
  const message = messageParts.length ? messageParts.join("; ") : null;
  await finishIngestionRun(db, {
    id: run.id,
    status,
    foundCount,
    loadedCount,
    newCount: loadedCount,
    updatedCount: 0,
    errorCount: failures.length + (analysisError ? 1 : 0),
    errorMessage: message,
    endedAt,
  });
  await recordSourceHealth(db, {
    sourceId,
    ingestionRunId: run.id,
    checkName: "trend-series",
    status: status === "succeeded" ? "healthy" : status === "partial" ? "degraded" : "unavailable",
    latencyMs: successes.reduce((sum, result) => sum + result.latencyMs, 0),
    httpStatus: failures[0]?.httpStatus ?? successes.at(-1)?.httpStatus ?? null,
    errorMessage: message,
    checkedAt: endedAt,
  });
  return {
    runId: run.id,
    runIds: [run.id],
    provider: "openalex-trends",
    layer: "trends",
    status,
    foundCount,
    loadedCount,
    newCount: loadedCount,
    updatedCount: 0,
    errorCount: failures.length + (analysisError ? 1 : 0),
    safetyLimit: 4,
    limitReached: false,
    pageCount: successes.length,
    sourceStatuses: [sourceStatus("openalex", "discovery", status === "succeeded" ? "healthy" : status === "partial" ? "degraded" : "unavailable", {
      httpStatus: failures[0]?.httpStatus ?? successes.at(-1)?.httpStatus ?? null,
      attempts: successes.reduce((sum, result) => sum + result.attempts, 0) + failures.reduce((sum, result) => sum + result.attempts, 0),
      message,
    })],
  };
}

export async function runIngestion(db: D1DatabaseLike, request: IngestionRequest, options: IngestionOptions = {}): Promise<IngestionSummary> {
  if ("dataset" in request && request.dataset === "trends") return ingestTrends(db, options);

  const legacy = "dataset" in request;
  const layer: SearchLayer = legacy ? request.dataset === "publications" ? "core" : "frontier" : request.layer;
  const layerRequest: LayerIngestionRequest = {
    layer,
    scope: request.scope,
    safetyLimit: request.safetyLimit,
  };
  const providers: WorkProvider[] = layer === "frontier" && !legacy ? ["openalex", "arxiv"] : ["openalex"];
  const results: ProviderResult[] = [];
  // Sequential DB writes avoid overlapping D1 batches; source HTTP requests still retry independently.
  for (const provider of providers) results.push(await ingestProvider(db, provider, layerRequest, options));
  return combine(results);
}
