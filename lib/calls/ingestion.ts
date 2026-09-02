import type { D1DatabaseLike } from "@/db/d1";
import { fetchWithRetry, SourceRequestError } from "../radar/http";
import { parseOfficialCallSource, ParserContractError } from "./adapters";
import { CALL_SOURCE_REGISTRY_VERSION, OFFICIAL_CALL_SOURCES, findCallSource } from "./config/sources.v1";
import {
  createCallIngestionRun,
  ensureCallSource,
  finishCallIngestionRun,
  getCallSourceState,
  markMissingCallsUnverified,
  persistCall,
  setCallSourceState,
} from "./repository";
import type { CallSourceStateStatus, OfficialCallSource } from "./types";

export type CallsIngestionRequest = {
  dataset: "calls";
  sourceKeys?: string[];
  approveChangedContent?: boolean;
};

export type CallSourceIngestionSummary = {
  sourceKey: string;
  sourceName: string;
  runId: string;
  status: "succeeded" | "partial" | "failed";
  sourceStatus: CallSourceStateStatus;
  foundCount: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  requiresManualReview: boolean;
  contentHash: string | null;
  message: string | null;
};

export type CallsIngestionSummary = {
  dataset: "calls";
  registryVersion: string;
  status: "succeeded" | "partial" | "failed";
  foundCount: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  requiresManualReview: boolean;
  sources: CallSourceIngestionSummary[];
};

type CallsIngestionOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
};

async function contentHash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function errorDetails(error: unknown) {
  if (error instanceof SourceRequestError) {
    return { message: error.message, status: "unavailable" as const };
  }
  if (error instanceof ParserContractError) {
    return { message: error.message, status: "parser_error" as const };
  }
  return { message: error instanceof Error ? error.message : "Unknown calls ingestion error", status: "parser_error" as const };
}

function validateRegistryUrl(source: OfficialCallSource) {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || !source.allowedHosts.includes(url.hostname)) {
    throw new ParserContractError(source.key, "Registry URL is not on an approved official host");
  }
  return url;
}

async function ingestSource(
  db: D1DatabaseLike,
  source: OfficialCallSource,
  approveChangedContent: boolean,
  options: CallsIngestionOptions,
): Promise<CallSourceIngestionSummary> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const sourceId = await ensureCallSource(db, source, startedAt);
  const runId = await createCallIngestionRun(db, sourceId, source, startedAt);
  try {
    const fetched = await fetchWithRetry(validateRegistryUrl(source), {
      source: source.name,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      baseDelayMs: 1_000,
      init: {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "HumanAIResearchRadar-Calls/1.0",
        },
      },
    });
    const contentType = fetched.response.headers.get("content-type");
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new ParserContractError(source.key, `Unexpected content type: ${contentType}`);
    }
    const html = await fetched.response.text();
    const parsed = parseOfficialCallSource(source, html);
    const parsedContentHash = await contentHash({ markers: parsed.structureMarkers, calls: parsed.calls });
    const prior = await getCallSourceState(db, sourceId);
    const firstVerifiedCapture = !prior?.approved_content_hash;
    const contentChanged = Boolean(prior?.approved_content_hash && prior.approved_content_hash !== parsedContentHash);
    const verified = firstVerifiedCapture || !contentChanged || approveChangedContent;
    const requiresManualReview = contentChanged && !approveChangedContent;
    const capturedAt = now();
    let newCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    for (const call of parsed.calls) {
      try {
        const saved = await persistCall(db, call, {
          sourceId,
          source,
          ingestionRunId: runId,
          capturedAt,
          verified,
        });
        if (saved.isNew) newCount += 1;
        else if (saved.updated) updatedCount += 1;
      } catch (error) {
        errorCount += 1;
        errors.push(error instanceof Error ? error.message : "Call persistence failed");
      }
    }
    if (verified && errorCount === 0) {
      await markMissingCallsUnverified(db, sourceId, parsed.calls.map((call) => call.sourceRecordId));
    }
    const sourceStatus: CallSourceStateStatus = errorCount > 0 ? "changed" : requiresManualReview ? "changed" : "verified";
    const manualReview = requiresManualReview || errorCount > 0;
    const message = manualReview
      ? errors.length
        ? [...new Set(errors)].slice(0, 4).join("; ")
        : "Official source content changed; manual review and explicit approval are required."
      : null;
    await setCallSourceState(db, {
      sourceId,
      source,
      status: sourceStatus,
      approvedContentHash: verified && errorCount === 0 ? parsedContentHash : null,
      lastContentHash: parsedContentHash,
      checkedAt: capturedAt,
      verifiedAt: verified && errorCount === 0 ? capturedAt : null,
      errorMessage: message,
    });
    const status = manualReview ? "partial" as const : "succeeded" as const;
    await finishCallIngestionRun(db, {
      id: runId,
      status,
      foundCount: parsed.calls.length,
      newCount,
      updatedCount,
      errorCount,
      contentHash: parsedContentHash,
      requiresManualReview: manualReview,
      errorMessage: message,
      endedAt: capturedAt,
    });
    return {
      sourceKey: source.key,
      sourceName: source.name,
      runId,
      status,
      sourceStatus,
      foundCount: parsed.calls.length,
      newCount,
      updatedCount,
      errorCount,
      requiresManualReview: manualReview,
      contentHash: parsedContentHash,
      message,
    };
  } catch (error) {
    const details = errorDetails(error);
    const endedAt = now();
    await setCallSourceState(db, {
      sourceId,
      source,
      status: details.status,
      checkedAt: endedAt,
      errorMessage: details.message,
    });
    await finishCallIngestionRun(db, {
      id: runId,
      status: "failed",
      foundCount: 0,
      newCount: 0,
      updatedCount: 0,
      errorCount: 1,
      requiresManualReview: details.status === "parser_error",
      errorMessage: details.message,
      endedAt,
    });
    return {
      sourceKey: source.key,
      sourceName: source.name,
      runId,
      status: "failed",
      sourceStatus: details.status,
      foundCount: 0,
      newCount: 0,
      updatedCount: 0,
      errorCount: 1,
      requiresManualReview: details.status === "parser_error",
      contentHash: null,
      message: details.message,
    };
  }
}

function overallStatus(results: CallSourceIngestionSummary[]): CallsIngestionSummary["status"] {
  if (results.every((result) => result.status === "succeeded")) return "succeeded";
  if (results.every((result) => result.status === "failed")) return "failed";
  return "partial";
}

export async function runCallsIngestion(
  db: D1DatabaseLike,
  request: CallsIngestionRequest,
  options: CallsIngestionOptions = {},
): Promise<CallsIngestionSummary> {
  const requestedKeys = request.sourceKeys?.length ? [...new Set(request.sourceKeys)] : OFFICIAL_CALL_SOURCES.map((source) => source.key);
  const sources = requestedKeys.map((key) => findCallSource(key));
  if (sources.some((source) => !source)) throw new Error("sourceKeys contains a source outside the official calls registry");
  const results: CallSourceIngestionSummary[] = [];
  for (const source of sources) {
    if (source) results.push(await ingestSource(db, source, Boolean(request.approveChangedContent), options));
  }
  return {
    dataset: "calls",
    registryVersion: CALL_SOURCE_REGISTRY_VERSION,
    status: overallStatus(results),
    foundCount: results.reduce((sum, result) => sum + result.foundCount, 0),
    newCount: results.reduce((sum, result) => sum + result.newCount, 0),
    updatedCount: results.reduce((sum, result) => sum + result.updatedCount, 0),
    errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
    requiresManualReview: results.some((result) => result.requiresManualReview),
    sources: results,
  };
}
