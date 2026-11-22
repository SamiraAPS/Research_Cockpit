import {
  AI_TERMS,
  ARXIV_CATEGORIES,
  ARXIV_INTER_PAGE_DELAY_MS,
  ARXIV_PAGE_SIZE,
  HUMAN_WORK_TERMS,
  HUMAN_FACTORS_TERMS,
  HUMAN_CONTEXT_TERMS,
  STATIC_SEARCH_CONFIG_VERSION,
  SEARCH_MODES
} from "./config.mjs";
import { fetchWithRetry } from "./http.mjs";
import { SourcePaginationError, dateRange } from "./openalex.mjs";
import { evidenceTermsFor, normalizeDoi, normalizeTitle, safeUrl } from "./normalize.mjs";

function decodeXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function tag(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1]).replace(/\s+/g, " ").trim() : null;
}

function attributes(xml, element) {
  return [...xml.matchAll(new RegExp(`<${element}\\s+([^>]+?)(?:\/?>)`, "gi"))].map((match) => {
    const result = {};
    for (const attribute of match[1].matchAll(/([\w:-]+)=["']([^"']*)["']/g)) result[attribute[1]] = decodeXml(attribute[2]);
    return result;
  });
}

function canonicalId(value) {
  return String(value).replace(/^https?:\/\/(?:export\.)?arxiv\.org\/abs\//i, "").replace(/v\d+$/i, "");
}

const quoted = term => `"${term.replaceAll('"', '\\"')}"`;
// Title or abstract; the compact form searches all fields with one clause per term.
const arxivTerm = term => `(ti:${quoted(term)} OR abs:${quoted(term)})`;
const compactTerm = term => `all:${quoted(term)}`;

// arXiv rejects request lines above 4094 bytes ("Request Line is too large").
export const ARXIV_MAX_REQUEST_LINE = 3800;
// arXiv answers broad full-text queries slowly; the general 20 s limit cut them off.
export const ARXIV_MIN_TIMEOUT_MS = 60_000;

function arxivDate(value, endOfDay = false) {
  return `${value.replaceAll("-", "")}${endOfDay ? "2359" : "0000"}`;
}

export function buildArxivUrl(options = {}) {
  const range = options.range ?? dateRange(options.days ?? 90, options.now);
  const categories = `(${ARXIV_CATEGORIES.map((category) => `cat:${category}`).join(" OR ")})`;
  const submitted = `submittedDate:[${arxivDate(range.from)} TO ${arxivDate(range.to, true)}]`;
  const build = (term) => {
    const group = terms => `(${terms.map(term).join(" OR ")})`;
    const topic = options.researchArea === "human-factors" ? group(HUMAN_FACTORS_TERMS) : `${group(AI_TERMS)} AND ${group([...HUMAN_WORK_TERMS, ...HUMAN_CONTEXT_TERMS])}`;
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", `${categories} AND ${topic} AND ${submitted}`);
    url.searchParams.set("start", String(options.start ?? 0));
    url.searchParams.set("max_results", String(options.maxResults ?? ARXIV_PAGE_SIZE));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");
    return url;
  };
  // Precise where it fits; otherwise the same terms across all fields. That is
  // slightly broader, and the ranking by closeness to the library sorts it afterwards.
  const precise = build(arxivTerm);
  const compact = precise.pathname.length + precise.search.length > ARXIV_MAX_REQUEST_LINE;
  return { url: compact ? build(compactTerm) : precise, range, compact };
}

export function parseArxivFeed(xml, context) {
  const totalResults = Number(tag(xml, "opensearch:totalResults") ?? 0);
  const records = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].flatMap((match) => {
    const entry = match[1];
    const idUrl = tag(entry, "id");
    const title = tag(entry, "title");
    if (!idUrl || !title) return [];
    const arxivId = canonicalId(idUrl);
    const doi = normalizeDoi(tag(entry, "arxiv:doi"));
    const publicationDate = tag(entry, "published")?.slice(0, 10) ?? null;
    const topics = attributes(entry, "category").map((category) => category.term).filter(Boolean);
    const links = attributes(entry, "link");
    const record = {
      provider: "arxiv",
      mode: "frontier",
      queryVersion: context.queryVersion ?? SEARCH_MODES.frontier.queryVersion,
      sourceRecordId: arxivId,
      externalIds: { arxiv: arxivId },
      doi,
      normalizedTitle: normalizeTitle(title),
      title,
      abstract: tag(entry, "summary"),
      authors: [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)].flatMap((authorMatch) => {
        const name = tag(authorMatch[1], "name");
        return name ? [{ id: null, name, orcid: null, affiliations: [] }] : [];
      }),
      venue: "arXiv",
      sourceType: "preprint",
      publicationDate,
      onlineDate: publicationDate,
      url: safeUrl(links.find((link) => link.rel === "alternate")?.href) ?? `https://arxiv.org/abs/${arxivId}`,
      openAccess: true,
      citedByCount: 0,
      topics,
      keywords: [],
      retrievedAt: context.retrievedAt,
      existingWork: null
    };
    record.evidenceTerms = evidenceTermsFor(record);
    return [record];
  });
  return { totalResults: Number.isFinite(totalResults) ? totalResults : records.length, records };
}

export async function ingestArxiv(options = {}) {
  const initial = buildArxivUrl(options);
  const stats = {
    source: "arXiv",
    provider: "arxiv",
    role: "discovery",
    modes: ["frontier"],
    queryVersions: [`${STATIC_SEARCH_CONFIG_VERSION}:frontier:${options.researchArea ?? "human-ai"}`],
    parameters: {
      endpoint: `${initial.url.origin}${initial.url.pathname}`,
      searchQuery: initial.url.searchParams.get("search_query"),
      pageSize: ARXIV_PAGE_SIZE,
      offsetPagination: true,
      interPageDelayMs: ARXIV_INTER_PAGE_DELAY_MS,
      fromDate: initial.range.from,
      toDate: initial.range.to
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
  const records = [];
  let start = options.start ?? 0;

  try {
    while (stats.pageCount === 0 || start < stats.foundCount) {
      const { url } = buildArxivUrl({ ...options, range: initial.range, start, maxResults: ARXIV_PAGE_SIZE });
      const request = await fetchWithRetry(url, {
        source: "arXiv",
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        timeoutMs: Math.max(options.timeoutMs ?? 0, ARXIV_MIN_TIMEOUT_MS),
        maxAttempts: options.maxAttempts,
        baseDelayMs: ARXIV_INTER_PAGE_DELAY_MS,
        init: { headers: { Accept: "application/atom+xml", "User-Agent": "HumanAIResearchRadar/4.0" } }
      });
      stats.pageCount += 1;
      stats.requestCount += 1;
      stats.attempts += request.attempts;
      stats.retryCount += request.attempts - 1;
      stats.rateLimitEvents += request.rateLimitEvents;
      stats.latencyMs += request.latencyMs;
      stats.httpStatus = request.response.status;
      const feed = parseArxivFeed(await request.response.text(), { retrievedAt: options.now?.toISOString?.() ?? new Date().toISOString(), queryVersion: stats.queryVersions[0] });
      if (stats.pageCount === 1) stats.foundCount = feed.totalResults;
      records.push(...feed.records);
      if (feed.records.length === 0 || start + feed.records.length >= stats.foundCount) { stats.parameters.nextStart = null; break; }
      start += feed.records.length;
      stats.parameters.nextStart = start;
      if (stats.pageCount >= (options.maxPages ?? Infinity)) {
        stats.status = "degraded";
        stats.message = "Seitenbudget erreicht; Fortsetzung am gespeicherten Offset.";
        break;
      }
      await (options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(ARXIV_INTER_PAGE_DELAY_MS);
    }
  } catch (error) {
    stats.recordCount = records.length;
    stats.status = records.length > 0 ? "degraded" : "unavailable";
    stats.message = error instanceof Error ? error.message : "arXiv-Pagination fehlgeschlagen";
    if (error && typeof error === "object") {
      stats.httpStatus = error.httpStatus ?? stats.httpStatus;
      stats.attempts += error.attempts ?? 0;
      stats.retryCount += Math.max(0, (error.attempts ?? 1) - 1);
      stats.rateLimitEvents += error.rateLimitEvents ?? 0;
      stats.latencyMs += error.latencyMs ?? 0;
    }
    throw new SourcePaginationError("arXiv", stats.message, { partialRecords: records, stats, cause: error });
  }

  stats.recordCount = records.length;
  return { records, stats };
}
