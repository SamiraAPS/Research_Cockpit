import { AI_TERMS, HUMAN_WORK_TERMS, INGESTION_ANALYSIS_VERSION, ONTOLOGY_VERSION } from "./config.mjs";

export function normalizeDoi(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return normalized || null;
}

export function normalizeTitle(value) {
  return String(value ?? "").toLocaleLowerCase("en").normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shortExternalId(value) {
  return String(value ?? "").split("/").filter(Boolean).at(-1) ?? "";
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function reconstructAbstract(index) {
  if (!index || typeof index !== "object") return null;
  const positioned = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    positions.forEach((position) => Number.isInteger(position) && positioned.push([position, word]));
  }
  positioned.sort((left, right) => left[0] - right[0]);
  return positioned.map(([, word]) => word).join(" ") || null;
}

export function evidenceTermsFor(record) {
  const haystack = normalizeTitle([record.title, record.abstract, ...(record.topics ?? []), ...(record.keywords ?? [])].filter(Boolean).join(" "));
  return uniqueStrings([...AI_TERMS, ...HUMAN_WORK_TERMS].filter((term) => haystack.includes(normalizeTitle(term)))).slice(0, 24);
}

export function normalizeOpenAlexWork(work, context) {
  const title = String(work.display_name ?? work.title ?? "").trim();
  const openAlexId = shortExternalId(work.id);
  if (!title || !openAlexId) throw new Error("OpenAlex-Datensatz ohne Titel oder ID");
  const source = work.primary_location?.source ?? {};
  const sourceId = shortExternalId(source.id);
  const sourceIsConference = source.type === "conference" || context.conferenceIds.has(sourceId);
  const sourceType = work.type === "preprint" ? "preprint" : sourceIsConference || work.type === "proceedings-article" ? "proceedings" : "journal";
  const topics = uniqueStrings((work.topics ?? []).map((topic) => topic?.display_name));
  const keywords = uniqueStrings((work.keywords ?? []).map((keyword) => keyword?.display_name));
  const doi = normalizeDoi(work.doi);
  const record = {
    provider: "openalex",
    mode: context.mode,
    queryVersion: context.queryVersion,
    sourceRecordId: openAlexId,
    externalIds: { openalex: openAlexId },
    doi,
    normalizedTitle: normalizeTitle(title),
    title,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: (work.authorships ?? []).flatMap((authorship) => {
      const name = String(authorship?.author?.display_name ?? "").trim();
      return name ? [{
        id: shortExternalId(authorship.author?.id) || null,
        name,
        orcid: authorship.author?.orcid ?? null,
        affiliations: []
      }] : [];
    }),
    venue: String(source.display_name ?? "").trim() || null,
    sourceType,
    publicationDate: work.publication_date ?? null,
    onlineDate: null,
    url: safeUrl(work.doi)
      ?? safeUrl(work.best_oa_location?.landing_page_url)
      ?? safeUrl(work.primary_location?.landing_page_url)
      ?? `https://openalex.org/${openAlexId}`,
    openAccess: typeof work.open_access?.is_oa === "boolean" ? work.open_access.is_oa : null,
    citedByCount: Number.isInteger(work.cited_by_count) ? work.cited_by_count : null,
    topics,
    keywords,
    retrievedAt: context.retrievedAt,
    existingWork: null
  };
  record.evidenceTerms = evidenceTermsFor(record);
  return record;
}

export function analysisFields(record) {
  return {
    classifiedThemes: record.existingWork?.classifiedThemes ?? [],
    scores: record.existingWork?.scores ?? { ingestionEvidence: record.evidenceTerms.length },
    evidenceTerms: uniqueStrings([...(record.existingWork?.evidenceTerms ?? []), ...record.evidenceTerms]),
    analysisVersion: INGESTION_ANALYSIS_VERSION,
    ontologyVersion: ONTOLOGY_VERSION
  };
}

export function unique(values) {
  return uniqueStrings(values);
}
