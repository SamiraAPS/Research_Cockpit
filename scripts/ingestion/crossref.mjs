import { CROSSREF_INTER_REQUEST_DELAY_MS } from "./config.mjs";
import { fetchWithRetry } from "./http.mjs";
import { evidenceTermsFor, normalizeDoi, safeUrl, unique } from "./normalize.mjs";

function dateFromParts(value) {
  const parts = value?.["date-parts"]?.[0];
  if (!parts?.[0]) return null;
  const [year, month = 1, day = 1] = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stripMarkup(value) {
  return typeof value === "string" ? value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null : null;
}

export function applyCrossrefEnrichment(record, metadata) {
  const authors = record.authors.length > 0 ? record.authors : (metadata.author ?? []).flatMap((author) => {
    const name = [author.given, author.family].filter(Boolean).join(" ").trim();
    return name ? [{ id: null, name, orcid: author.ORCID ?? null, affiliations: [] }] : [];
  });
  const enriched = {
    ...record,
    doi: normalizeDoi(metadata.DOI) ?? record.doi,
    abstract: record.abstract ?? stripMarkup(metadata.abstract),
    authors,
    onlineDate: record.onlineDate ?? dateFromParts(metadata["published-online"]) ?? dateFromParts(metadata.published),
    topics: unique([...record.topics, ...(metadata.subject ?? [])]),
    url: record.url ?? safeUrl(metadata.URL) ?? (record.doi ? `https://doi.org/${record.doi}` : null)
  };
  enriched.evidenceTerms = evidenceTermsFor(enriched);
  return enriched;
}

export async function enrichWithCrossref(records, options = {}) {
  const eligible = records.filter((record) => record.doi && (!record.abstract || record.authors.length === 0 || !record.onlineDate));
  const stats = {
    source: "Crossref",
    provider: "crossref",
    role: "enrichment",
    modes: [...new Set(records.map((record) => record.mode))],
    queryVersions: ["static-crossref-enrichment-4.0.0"],
    parameters: {
      endpoint: "https://api.crossref.org/works/{doi}",
      lookup: "DOI singleton only",
      discovery: false,
      eligibleRecords: eligible.length,
      interRequestDelayMs: CROSSREF_INTER_REQUEST_DELAY_MS
    },
    foundCount: eligible.length,
    recordCount: 0,
    pageCount: 0,
    requestCount: 0,
    attempts: 0,
    retryCount: 0,
    rateLimitEvents: 0,
    latencyMs: 0,
    httpStatus: null,
    status: eligible.length === 0 ? "not_checked" : "healthy",
    message: eligible.length === 0 ? "Keine Datensätze benötigten DOI-Enrichment." : null
  };
  if (options.disabled || eligible.length === 0) {
    if (options.disabled) {
      stats.status = "not_checked";
      stats.message = "Crossref-Enrichment wurde für diesen Lauf explizit deaktiviert.";
    }
    return { records, stats };
  }

  const replacements = new Map();
  const failures = [];
  for (const record of eligible) {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(record.doi)}`);
    if (options.mailto) url.searchParams.set("mailto", options.mailto);
    try {
      const request = await fetchWithRetry(url, {
        source: "Crossref",
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        baseDelayMs: 750,
        init: {
          headers: {
            Accept: "application/json",
            "User-Agent": options.mailto ? `HumanAIResearchRadar/4.0 (mailto:${options.mailto})` : "HumanAIResearchRadar/4.0"
          }
        }
      });
      stats.requestCount += 1;
      stats.pageCount += 1;
      stats.attempts += request.attempts;
      stats.retryCount += request.attempts - 1;
      stats.rateLimitEvents += request.rateLimitEvents;
      stats.latencyMs += request.latencyMs;
      stats.httpStatus = request.response.status;
      const payload = await request.response.json();
      if (payload.status !== "ok" || !payload.message) throw new Error("Crossref-Antwort enthält keine Metadaten");
      replacements.set(record, applyCrossrefEnrichment(record, payload.message));
      stats.recordCount += 1;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Crossref-Enrichment fehlgeschlagen");
      if (error && typeof error === "object") {
        stats.httpStatus = error.httpStatus ?? stats.httpStatus;
        stats.attempts += error.attempts ?? 1;
        stats.retryCount += Math.max(0, (error.attempts ?? 1) - 1);
        stats.rateLimitEvents += error.rateLimitEvents ?? 0;
        stats.latencyMs += error.latencyMs ?? 0;
      }
    }
    if (record !== eligible.at(-1)) await (options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(CROSSREF_INTER_REQUEST_DELAY_MS);
  }

  if (failures.length > 0) {
    stats.status = stats.recordCount > 0 ? "degraded" : "unavailable";
    stats.message = [...new Set(failures)].slice(0, 3).join("; ");
  }
  return { records: records.map((record) => replacements.get(record) ?? record), stats };
}
