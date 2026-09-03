import {
  AI_TERMS,
  CORE_CONFERENCES,
  HUMAN_WORK_TERMS,
  OPENALEX_PAGE_SIZE,
  SEARCH_MODES
} from "./config.mjs";
import { fetchWithRetry } from "./http.mjs";
import { normalizeOpenAlexWork } from "./normalize.mjs";

export class SourcePaginationError extends Error {
  constructor(source, message, details = {}) {
    super(message);
    this.name = "SourcePaginationError";
    this.source = source;
    this.partialRecords = details.partialRecords ?? [];
    this.stats = details.stats ?? {};
    this.cause = details.cause;
  }
}

function quoted(term) {
  return `"${term.replaceAll('"', '\\"')}"`;
}

function booleanTerms(terms) {
  return `(${terms.map(quoted).join(" OR ")})`;
}

export function dateRange(days, now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function buildOpenAlexUrl(mode, options = {}) {
  const config = SEARCH_MODES[mode];
  if (!config) throw new Error(`Unbekannter OpenAlex-Modus ${mode}`);
  const range = options.range ?? dateRange(options.days ?? 90, options.now);
  const filters = [
    `from_publication_date:${range.from}`,
    `to_publication_date:${range.to}`,
    "is_retracted:false",
    `type:${config.workTypes.join("|")}`,
    `title_and_abstract.search:${booleanTerms(AI_TERMS)} AND ${booleanTerms(HUMAN_WORK_TERMS)}`
  ];
  if (config.sourceIds.length > 0) filters.unshift(`primary_location.source.id:${[...new Set(config.sourceIds)].join("|")}`);

  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("sort", "publication_date:desc");
  url.searchParams.set("per_page", String(OPENALEX_PAGE_SIZE));
  url.searchParams.set("cursor", "*");
  url.searchParams.set("corpus", "all");
  url.searchParams.set("select", "id,doi,display_name,publication_date,type,cited_by_count,abstract_inverted_index,authorships,primary_location,best_oa_location,open_access,topics,keywords");
  return { url, range, config };
}

function statsBase(mode, queryVersion, range, url) {
  return {
    source: "OpenAlex",
    provider: "openalex",
    role: "discovery",
    modes: [mode],
    queryVersions: [queryVersion],
    parameters: {
      endpoint: `${url.origin}${url.pathname}`,
      filter: url.searchParams.get("filter"),
      sort: url.searchParams.get("sort"),
      perPage: OPENALEX_PAGE_SIZE,
      cursorPagination: true,
      corpus: url.searchParams.get("corpus"),
      fromDate: range.from,
      toDate: range.to
    },
    foundCount: 0,
    recordCount: 0,
    pageCount: 0,
    requestCount: 0,
    attempts: 0,
    retryCount: 0,
    rateLimitEvents: 0,
    latencyMs: 0,
    httpStatus: null,
    status: "healthy",
    message: null
  };
}

export async function ingestOpenAlex(mode, options = {}) {
  const { url: baseUrl, range, config } = buildOpenAlexUrl(mode, options);
  const records = [];
  const seenCursors = new Set();
  const stats = statsBase(mode, config.queryVersion, range, baseUrl);
  const conferenceIds = new Set(CORE_CONFERENCES.map((source) => source.id));
  let cursor = "*";

  try {
    while (cursor) {
      if (seenCursors.has(cursor)) throw new Error("OpenAlex lieferte einen bereits verwendeten Cursor");
      seenCursors.add(cursor);
      const requestUrl = new URL(baseUrl);
      requestUrl.searchParams.set("cursor", cursor);
      if (options.apiKey) requestUrl.searchParams.set("api_key", options.apiKey);
      const request = await fetchWithRetry(requestUrl, {
        source: "OpenAlex",
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        baseDelayMs: 500,
        init: { headers: { Accept: "application/json", "User-Agent": "HumanAIResearchRadar/4.0" } }
      });
      stats.pageCount += 1;
      stats.requestCount += 1;
      stats.attempts += request.attempts;
      stats.retryCount += request.attempts - 1;
      stats.rateLimitEvents += request.rateLimitEvents;
      stats.latencyMs += request.latencyMs;
      stats.httpStatus = request.response.status;
      const payload = await request.response.json();
      if (!Array.isArray(payload.results)) throw new Error("OpenAlex-Antwort enthält kein results-Array");
      if (stats.pageCount === 1) stats.foundCount = Number.isInteger(payload.meta?.count) ? payload.meta.count : payload.results.length;
      const retrievedAt = options.now?.toISOString?.() ?? new Date().toISOString();
      for (const work of payload.results) {
        records.push(normalizeOpenAlexWork(work, {
          mode,
          queryVersion: config.queryVersion,
          conferenceIds,
          retrievedAt
        }));
      }
      const nextCursor = payload.meta?.next_cursor ?? null;
      cursor = payload.results.length > 0 ? nextCursor : null;
    }
  } catch (error) {
    stats.recordCount = records.length;
    stats.status = records.length > 0 ? "degraded" : "unavailable";
    stats.message = error instanceof Error ? error.message : "OpenAlex-Pagination fehlgeschlagen";
    if (error && typeof error === "object") {
      stats.httpStatus = error.httpStatus ?? stats.httpStatus;
      stats.attempts += error.attempts ?? 0;
      stats.retryCount += Math.max(0, (error.attempts ?? 1) - 1);
      stats.rateLimitEvents += error.rateLimitEvents ?? 0;
      stats.latencyMs += error.latencyMs ?? 0;
    }
    throw new SourcePaginationError("OpenAlex", stats.message, { partialRecords: records, stats, cause: error });
  }

  stats.recordCount = records.length;
  return { records, stats };
}
