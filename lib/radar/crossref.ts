import { classifyThemes, normalizeDoi } from "./config";
import { fetchWithRetry, type RetryingFetchOptions } from "./http";
import type { IngestibleWork } from "./work";

type CrossrefOptions = Pick<RetryingFetchOptions, "fetchImpl" | "maxAttempts" | "sleep"> & {
  mailto?: string;
};

type CrossrefMessage = {
  DOI?: string;
  title?: string[];
  abstract?: string;
  author?: Array<{ given?: string; family?: string; ORCID?: string }>;
  subject?: string[];
  URL?: string;
  "published-online"?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
};

type CrossrefResponse = { status?: string; message?: CrossrefMessage };

export type CrossrefEnrichment = {
  work: IngestibleWork;
  latencyMs: number;
  httpStatus: number;
  attempts: number;
};

function dateFromParts(value?: { "date-parts"?: number[][] }) {
  const parts = value?.["date-parts"]?.[0];
  if (!parts?.[0]) return null;
  const [year, month = 1, day = 1] = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stripMarkup(value?: string) {
  if (!value) return null;
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

export async function enrichWithCrossref(input: IngestibleWork, options: CrossrefOptions = {}): Promise<CrossrefEnrichment> {
  if (!input.doiNormalized) throw new Error("Crossref enrichment requires a DOI");
  const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(input.doiNormalized)}`);
  if (options.mailto) url.searchParams.set("mailto", options.mailto);
  const fetched = await fetchWithRetry(url, {
    source: "Crossref",
    fetchImpl: options.fetchImpl,
    maxAttempts: options.maxAttempts,
    sleep: options.sleep,
    baseDelayMs: 750,
    init: {
      headers: {
        Accept: "application/json",
        "User-Agent": options.mailto ? `HumanAIResearchRadar/3.0 (mailto:${options.mailto})` : "HumanAIResearchRadar/3.0",
      },
    },
  });
  const payload = await fetched.response.json() as CrossrefResponse;
  if (payload.status !== "ok" || !payload.message) throw new Error("Crossref response is missing metadata");
  const metadata = payload.message;
  const abstract = input.abstract ?? stripMarkup(metadata.abstract);
  const authors = input.authors.length > 0 ? input.authors : (metadata.author ?? []).flatMap((author, index) => {
    const name = [author.given, author.family].filter(Boolean).join(" ").trim();
    return name ? [{ id: null, name, orcid: author.ORCID ?? null, position: index === 0 ? "first" : null }] : [];
  });
  const topics = [...new Set([...input.topics, ...(metadata.subject ?? [])])];
  const doiNormalized = normalizeDoi(metadata.DOI) ?? input.doiNormalized;
  const work: IngestibleWork = {
    ...input,
    doi: metadata.DOI ?? input.doi,
    doiNormalized,
    abstract,
    authors,
    onlineDate: input.onlineDate ?? dateFromParts(metadata["published-online"]) ?? dateFromParts(metadata.published),
    url: input.url || metadata.URL || `https://doi.org/${doiNormalized}`,
    topics,
    themes: classifyThemes(input.title, abstract, topics, input.keywords),
  };
  return {
    work,
    latencyMs: fetched.latencyMs,
    httpStatus: fetched.response.status,
    attempts: fetched.attempts,
  };
}

