import { classifyThemes, normalizeDoi, normalizeTitle } from "./config";
import {
  AI_SEARCH_TERMS,
  ARXIV_CATEGORIES,
  ARXIV_INTER_PAGE_DELAY_MS,
  ARXIV_PAGE_SIZE,
  FIELD_SEARCH_TERMS,
  HUMAN_WORK_SEARCH_TERMS,
} from "./config/search.v3";
import { fetchWithRetry, type RetryingFetchOptions } from "./http";
import type { IngestibleWork } from "./work";

type ArxivOptions = Pick<RetryingFetchOptions, "fetchImpl" | "maxAttempts" | "sleep">;

export type ArxivFeed = {
  totalResults: number;
  entries: IngestibleWork[];
};

export type ArxivPaginationResult = {
  records: IngestibleWork[];
  foundCount: number;
  pageCount: number;
  limitReached: boolean;
  latencyMs: number;
  attempts: number;
  httpStatus: number;
};

function dateDaysAgo(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().replace(/\D/g, "").slice(0, 12);
}

function arxivTerm(term: string) {
  const escaped = term.replaceAll('"', '\\"');
  return `(ti:"${escaped}" OR abs:"${escaped}")`;
}

export function buildArxivUrl(days: number, scope: "ai" | "field", start = 0, maxResults = ARXIV_PAGE_SIZE) {
  const ai = `(${AI_SEARCH_TERMS.map(arxivTerm).join(" OR ")})`;
  const human = `(${(scope === "ai" ? HUMAN_WORK_SEARCH_TERMS : FIELD_SEARCH_TERMS).map(arxivTerm).join(" OR ")})`;
  const categories = `(${ARXIV_CATEGORIES.map((category) => `cat:${category}`).join(" OR ")})`;
  const today = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  const date = `submittedDate:[${dateDaysAgo(days)} TO ${today}]`;
  const query = [categories, scope === "ai" ? ai : null, human, date].filter(Boolean).join(" AND ");
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", query);
  url.searchParams.set("start", String(start));
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  return url;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function tag(xml: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1]).replace(/\s+/g, " ").trim() : null;
}

function attributes(xml: string, element: string) {
  return [...xml.matchAll(new RegExp(`<${element}\\s+([^>]+?)(?:\\/?>)`, "gi"))].map((match) => {
    const values: Record<string, string> = {};
    for (const attribute of match[1].matchAll(/([\w:-]+)=["']([^"']*)["']/g)) values[attribute[1]] = decodeXml(attribute[2]);
    return values;
  });
}

function canonicalArxivId(idUrl: string) {
  return idUrl.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/abs\//i, "").replace(/v\d+$/i, "");
}

export function parseArxivFeed(xml: string, retrievedAt: string): ArxivFeed {
  const totalResults = Number(tag(xml, "opensearch:totalResults") ?? 0);
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].flatMap((match) => {
    const entry = match[1];
    const idUrl = tag(entry, "id");
    const title = tag(entry, "title");
    if (!idUrl || !title) return [];
    const arxivId = canonicalArxivId(idUrl);
    const doi = tag(entry, "arxiv:doi");
    const doiNormalized = normalizeDoi(doi);
    const abstract = tag(entry, "summary");
    const published = tag(entry, "published");
    const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)].flatMap((authorMatch, index) => {
      const name = tag(authorMatch[1], "name");
      return name ? [{ id: null, name, orcid: null, position: index === 0 ? "first" : null }] : [];
    });
    const topics = attributes(entry, "category").map((category) => category.term).filter(Boolean);
    const links = attributes(entry, "link");
    const alternate = links.find((link) => link.rel === "alternate")?.href;
    const url = alternate ?? `https://arxiv.org/abs/${arxivId}`;
    const publicationDate = published?.slice(0, 10) ?? null;
    return [{
      provider: "arxiv" as const,
      doi,
      doiNormalized,
      openAlexId: null,
      sourceRecordId: `arxiv:${arxivId}`,
      normalizedTitle: normalizeTitle(title),
      title,
      abstract,
      authors,
      sourceExternalId: "arxiv",
      sourceName: "arXiv",
      sourceKind: "repository" as const,
      sourceType: "preprint" as const,
      publicationDate,
      onlineDate: publicationDate,
      url,
      isOpenAccess: true,
      openAccessStatus: "green",
      citedByCount: 0,
      topics,
      keywords: [],
      themes: classifyThemes(title, abstract, topics, []),
      retrievedAt,
    } satisfies IngestibleWork];
  });
  return { totalResults: Number.isFinite(totalResults) ? totalResults : entries.length, entries };
}

export async function paginateArxiv(days: number, scope: "ai" | "field", safetyLimit: number, options: ArxivOptions = {}): Promise<ArxivPaginationResult> {
  const records: IngestibleWork[] = [];
  let foundCount = 0;
  let pageCount = 0;
  let latencyMs = 0;
  let attempts = 0;
  let httpStatus = 200;

  while (records.length < safetyLimit) {
    const pageSize = Math.min(ARXIV_PAGE_SIZE, safetyLimit - records.length);
    const url = buildArxivUrl(days, scope, records.length, pageSize);
    const fetched = await fetchWithRetry(url, {
      source: "arXiv",
      fetchImpl: options.fetchImpl,
      maxAttempts: options.maxAttempts,
      sleep: options.sleep,
      baseDelayMs: ARXIV_INTER_PAGE_DELAY_MS,
      init: { headers: { Accept: "application/atom+xml", "User-Agent": "HumanAIResearchRadar/3.0" } },
    });
    const feed = parseArxivFeed(await fetched.response.text(), new Date().toISOString());
    pageCount += 1;
    latencyMs += fetched.latencyMs;
    attempts += fetched.attempts;
    httpStatus = fetched.response.status;
    if (pageCount === 1) foundCount = feed.totalResults;
    records.push(...feed.entries.slice(0, safetyLimit - records.length));
    if (feed.entries.length === 0 || records.length >= foundCount) break;
    if (records.length < safetyLimit) await (options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(ARXIV_INTER_PAGE_DELAY_MS);
  }

  return {
    records,
    foundCount: foundCount || records.length,
    pageCount,
    limitReached: records.length >= safetyLimit && foundCount > records.length,
    latencyMs,
    attempts,
    httpStatus,
  };
}
