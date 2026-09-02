import { classifyThemes, normalizeDoi, normalizeTitle } from "./config";
import {
  AI_TERMS,
  FIELD_TERMS,
  HUMAN_AI_TERMS,
  OPENALEX_PAGE_SIZE,
  type SearchLayer,
} from "./config/search.v3";
import { CORE_CONFERENCES, CORE_JOURNALS, FRONTIER_PROCEEDINGS, FRONTIER_REPOSITORIES } from "./config/sources.v3";
import { fetchWithRetry, type RetryingFetchOptions } from "./http";
import type { IngestibleWork } from "./work";

export type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  display_name?: string;
  title?: string;
  publication_date?: string;
  type?: string;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{
    author_position?: string;
    author?: { id?: string; display_name?: string; orcid?: string | null };
  }>;
  primary_location?: {
    landing_page_url?: string | null;
    source?: { display_name?: string; id?: string; type?: string } | null;
  } | null;
  best_oa_location?: { landing_page_url?: string | null } | null;
  open_access?: { is_oa?: boolean; oa_status?: string | null } | null;
  topics?: Array<{ display_name?: string }>;
  keywords?: Array<{ display_name?: string }>;
};

export type OpenAlexList = {
  meta?: { count?: number; next_cursor?: string | null };
  results?: OpenAlexWork[];
  group_by?: Array<{ key?: string | number; count?: number }>;
};

export type OpenAlexFetchResult = {
  payload: OpenAlexList;
  latencyMs: number;
  httpStatus: number;
  attempts: number;
};

export type OpenAlexPaginationResult = {
  records: OpenAlexWork[];
  foundCount: number;
  pageCount: number;
  limitReached: boolean;
  latencyMs: number;
  attempts: number;
  httpStatus: number;
};

type OpenAlexOptions = Pick<RetryingFetchOptions, "fetchImpl" | "maxAttempts" | "sleep"> & {
  apiKey?: string;
};

function dateDaysAgo(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function sourceIds(layer: SearchLayer) {
  if (layer === "core") return [...CORE_JOURNALS, ...CORE_CONFERENCES].map((source) => source.id);
  if (layer === "frontier") return [...FRONTIER_REPOSITORIES, ...FRONTIER_PROCEEDINGS].map((source) => source.id);
  return [];
}

export function buildWorksUrl(layer: SearchLayer, days: number, scope: "ai" | "field") {
  const today = new Date().toISOString().slice(0, 10);
  const filters = [
    `from_publication_date:${dateDaysAgo(days)}`,
    `to_publication_date:${today}`,
    "is_retracted:false",
  ];
  const configuredSourceIds = [...new Set(sourceIds(layer))];
  if (configuredSourceIds.length > 0) filters.unshift(`primary_location.source.id:${configuredSourceIds.join("|")}`);
  if (layer === "broad") filters.push("type:article|review|book-chapter");
  const humanTerms = scope === "ai" ? HUMAN_AI_TERMS : FIELD_TERMS;
  filters.push(`title_and_abstract.search:${scope === "ai" ? `${AI_TERMS} AND ${humanTerms}` : humanTerms}`);

  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("sort", "publication_date:desc");
  url.searchParams.set("per_page", String(OPENALEX_PAGE_SIZE));
  url.searchParams.set("cursor", "*");
  url.searchParams.set("corpus", "all");
  url.searchParams.set("select", "id,doi,display_name,publication_date,type,cited_by_count,abstract_inverted_index,authorships,primary_location,best_oa_location,open_access,topics,keywords");
  return url;
}

export function buildTrendUrl(type: "article" | "preprint", scope: "ai" | "field" = "ai") {
  const year = new Date().getUTCFullYear();
  const comparisonTerms = scope === "ai" ? `${AI_TERMS} AND ${HUMAN_AI_TERMS}` : FIELD_TERMS;
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `type:${type},topics.field.id:32,publication_year:${year - 11}-${year},is_retracted:false,title_and_abstract.search:${comparisonTerms}`);
  url.searchParams.set("group_by", "publication_year");
  url.searchParams.set("corpus", "all");
  return url;
}

export async function fetchOpenAlex(
  url: URL,
  expected: "results" | "group_by",
  options: OpenAlexOptions = {},
): Promise<OpenAlexFetchResult> {
  const requestUrl = new URL(url);
  if (options.apiKey) requestUrl.searchParams.set("api_key", options.apiKey);
  const result = await fetchWithRetry(requestUrl, {
    source: "OpenAlex",
    fetchImpl: options.fetchImpl,
    maxAttempts: options.maxAttempts,
    sleep: options.sleep,
    baseDelayMs: 500,
  });
  const payload = await result.response.json() as OpenAlexList;
  if (!Array.isArray(payload[expected])) {
    throw new Error(`OpenAlex response is missing ${expected}`);
  }
  return {
    payload,
    latencyMs: result.latencyMs,
    httpStatus: result.response.status,
    attempts: result.attempts,
  };
}

export async function paginateOpenAlex(baseUrl: URL, safetyLimit: number, options: OpenAlexOptions = {}): Promise<OpenAlexPaginationResult> {
  const records: OpenAlexWork[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = "*";
  let foundCount = 0;
  let pageCount = 0;
  let latencyMs = 0;
  let attempts = 0;
  let httpStatus = 200;
  let hasMore = false;

  while (cursor && records.length < safetyLimit) {
    if (seenCursors.has(cursor)) throw new Error("OpenAlex returned a repeated cursor");
    seenCursors.add(cursor);
    const url = new URL(baseUrl);
    url.searchParams.set("cursor", cursor);
    const page = await fetchOpenAlex(url, "results", options);
    pageCount += 1;
    latencyMs += page.latencyMs;
    attempts += page.attempts;
    httpStatus = page.httpStatus;
    if (pageCount === 1) foundCount = page.payload.meta?.count ?? page.payload.results?.length ?? 0;
    const pageRecords = page.payload.results ?? [];
    const remaining = safetyLimit - records.length;
    records.push(...pageRecords.slice(0, remaining));
    cursor = page.payload.meta?.next_cursor ?? null;
    hasMore = Boolean(cursor) || pageRecords.length > remaining;
    if (pageRecords.length === 0) break;
  }

  return {
    records,
    foundCount: foundCount || records.length,
    pageCount,
    limitReached: records.length >= safetyLimit && (hasMore || foundCount > records.length),
    latencyMs,
    attempts,
    httpStatus,
  };
}

function reconstructAbstract(index?: Record<string, number[]> | null) {
  if (!index) return null;
  const tokens: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) tokens.push([position, word]);
  }
  tokens.sort((a, b) => a[0] - b[0]);
  return tokens.map(([, word]) => word).join(" ") || null;
}

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function workSourceType(work: OpenAlexWork): Pick<IngestibleWork, "sourceKind" | "sourceType"> {
  const sourceId = work.primary_location?.source?.id?.split("/").pop();
  const conferenceIds = new Set([...CORE_CONFERENCES, ...FRONTIER_PROCEEDINGS].map((source) => source.id));
  if (work.type === "preprint") return { sourceKind: "repository", sourceType: "preprint" };
  if (work.primary_location?.source?.type === "conference" || (sourceId && conferenceIds.has(sourceId))) {
    return { sourceKind: "conference", sourceType: "proceedings" };
  }
  return { sourceKind: "journal", sourceType: "journal" };
}

export function normalizeOpenAlexWork(work: OpenAlexWork, retrievedAt: string): IngestibleWork {
  const title = (work.display_name ?? work.title ?? "").trim();
  const openAlexId = safeUrl(work.id);
  if (!title || !openAlexId) throw new Error("OpenAlex work is missing a title or OpenAlex ID");
  const topics = (work.topics ?? []).map((topic) => topic.display_name?.trim()).filter((value): value is string => Boolean(value));
  const keywords = (work.keywords ?? []).map((keyword) => keyword.display_name?.trim()).filter((value): value is string => Boolean(value));
  const abstract = reconstructAbstract(work.abstract_inverted_index);
  const doiNormalized = normalizeDoi(work.doi);
  const doiUrl = doiNormalized ? `https://doi.org/${doiNormalized}` : null;
  const sourceName = work.primary_location?.source?.display_name?.trim() || "OpenAlex source unavailable";
  const sourceType = workSourceType(work);
  return {
    provider: "openalex",
    doi: work.doi ?? null,
    doiNormalized,
    openAlexId,
    sourceRecordId: openAlexId,
    normalizedTitle: normalizeTitle(title),
    title,
    abstract,
    authors: (work.authorships ?? []).flatMap((authorship) => {
      const name = authorship.author?.display_name?.trim();
      return name ? [{ id: authorship.author?.id ?? null, name, orcid: authorship.author?.orcid ?? null, position: authorship.author_position ?? null }] : [];
    }),
    sourceExternalId: work.primary_location?.source?.id ?? null,
    sourceName,
    ...sourceType,
    publicationDate: work.publication_date ?? null,
    onlineDate: null,
    url: safeUrl(work.doi) ?? safeUrl(work.best_oa_location?.landing_page_url) ?? safeUrl(work.primary_location?.landing_page_url) ?? doiUrl ?? openAlexId,
    isOpenAccess: Boolean(work.open_access?.is_oa) || sourceType.sourceType === "preprint",
    openAccessStatus: work.open_access?.oa_status ?? null,
    citedByCount: work.cited_by_count ?? 0,
    topics,
    keywords,
    themes: classifyThemes(title, abstract, topics, keywords),
    retrievedAt,
  };
}

export type { IngestibleWork } from "./work";
