import { matchesNovelty, csvCell } from "./research.js";
const prepared = new WeakMap();
const documentMaps = new WeakMap();
export function normalizeSearchText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchableText(document) {
  return normalizeSearchText([
    document.title,
    document.abstract,
    ...(document.authors ?? []),
    document.venue,
    ...(document.topics ?? []),
    ...(document.keywords ?? []),
    ...(document.themes ?? []),
    ...(document.evidenceTerms ?? [])
  ].join(" "));
}

export function scoreDocument(document, query) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return 0;
  let cached = prepared.get(document);
  if (!cached) {
    cached = { title: normalizeSearchText(document.title), abstract: normalizeSearchText(document.abstract),
      authors: normalizeSearchText((document.authors ?? []).map(a => typeof a === "string" ? a : a.name).join(" ")),
      facets: normalizeSearchText([document.venue, ...(document.topics ?? []), ...(document.keywords ?? []), ...(document.themes ?? []), ...(document.evidenceTerms ?? [])].join(" ")),
      all: searchableText(document) };
    prepared.set(document, cached);
  }
  const { title, abstract, authors, facets, all } = cached;
  if (!terms.every((term) => all.includes(term))) return -1;
  return terms.reduce((score, term) => score
    + (title.includes(term) ? 8 : 0)
    + (authors.includes(term) ? 4 : 0)
    + (facets.includes(term) ? 3 : 0)
    + (abstract.includes(term) ? 1 : 0), 0);
}

function publicationKind(work) {
  if (work.recordType === "preprint") return "preprint";
  const preferred = work.versions?.find((version) => version.id === work.preferredVersionId) ?? work.versions?.[0];
  return preferred?.type ?? "journal";
}

function matchesFilter(value, selected) {
  return !selected || selected === "all" || value === selected;
}

export function searchAndFilterWorks(works, documents, filters = {}) {
  let documentsById = documentMaps.get(documents);
  if (!documentsById) { documentsById = new Map(documents.map(document => [document.id, document])); documentMaps.set(documents, documentsById); }
  return works.flatMap((work) => {
    if (filters.workId && work.id !== filters.workId) return [];
    if (!matchesNovelty(work, filters.novelty, filters.noveltyContext)) return [];
    const document = documentsById.get(work.id) ?? work;
    const relevance = scoreDocument(document, filters.query);
    if (relevance < 0) return [];
    const year = String(work.publicationDate ?? "").slice(0, 4);
    const sources = new Set([work.source?.name, ...(work.discoveredBy ?? []).map((entry) => entry.provider)].filter(Boolean).map(normalizeSearchText));
    const modes = new Set((work.discoveredBy ?? []).map((entry) => entry.mode));
    const themes = new Set((work.classifiedThemes ?? []).map((entry) => entry.theme));
    if (!matchesFilter(year, filters.year)) return [];
    if (filters.source && filters.source !== "all" && !sources.has(normalizeSearchText(filters.source))) return [];
    if (!matchesFilter(publicationKind(work), filters.type)) return [];
    if (filters.theme && filters.theme !== "all" && !themes.has(filters.theme)) return [];
    if (filters.mode && filters.mode !== "all" && !modes.has(filters.mode)) return [];
    if (!matchesFilter(work.dataStatus ?? "current", filters.dataStatus)) return [];
    if (filters.shortlistOnly && !filters.shortlistIds?.has(work.id)) return [];
    return [{ work, document, relevance, kind: publicationKind(work) }];
  });
}

export function sortWorkResults(results, sort = "newest") {
  return [...results].sort((left, right) => {
    if (sort === "relevance") return right.relevance - left.relevance || String(right.work.publicationDate ?? "").localeCompare(String(left.work.publicationDate ?? ""));
    if (sort === "oldest") return String(left.work.publicationDate ?? "").localeCompare(String(right.work.publicationDate ?? "")) || left.work.title.localeCompare(right.work.title);
    if (sort === "title") return left.work.title.localeCompare(right.work.title, "de");
    if (sort === "citations") return (right.work.citedByCount ?? 0) - (left.work.citedByCount ?? 0) || String(right.work.publicationDate ?? "").localeCompare(String(left.work.publicationDate ?? ""));
    return String(right.work.publicationDate ?? "").localeCompare(String(left.work.publicationDate ?? "")) || left.work.title.localeCompare(right.work.title, "de");
  });
}

export function paginate(items, page = 1, pageSize = 8) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), currentPage, totalPages, totalItems: items.length };
}

const csvValue = csvCell;

export function worksToCsv(works) {
  const rows = [["id", "title", "authors", "venue", "publicationDate", "type", "doi", "themes", "dataStatus", "url", "abstract", "firstSeenAt", "source_modes"]];
  for (const work of works) rows.push([
    work.id,
    work.title,
    (work.authors ?? []).map((author) => author.name).join("; "),
    work.venue,
    work.publicationDate,
    publicationKind(work),
    work.doi,
    (work.classifiedThemes ?? []).map((theme) => theme.theme).join("; "),
    work.dataStatus,
    work.url, work.abstract, work.firstSeenAt, (work.discoveredBy ?? []).map(d => d.mode).join("; ")
  ]);
  return rows.map((row) => row.map(csvValue).join(",")).join("\r\n");
}

function bibtexText(value) {
  return String(value ?? "").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

function citationKey(work, index) {
  const family = work.authors?.[0]?.name?.split(/\s+/).at(-1) ?? "Radar";
  const year = String(work.publicationDate ?? "n.d.").slice(0, 4);
  return `${normalizeSearchText(family).replaceAll(" ", "") || "Radar"}${year}${index + 1}`;
}

export function worksToBibtex(works) {
  return works.map((work, index) => {
    const kind = publicationKind(work) === "proceedings" ? "inproceedings" : work.recordType === "preprint" ? "misc" : "article";
    const fields = [
      ["title", work.title],
      ["author", (work.authors ?? []).map((author) => author.name).join(" and ")],
      [kind === "inproceedings" ? "booktitle" : "journal", work.venue],
      ["year", String(work.publicationDate ?? "").slice(0, 4)],
      ["doi", work.doi],
      ["url", work.url]
    ].filter(([, value]) => value);
    return `@${kind}{${citationKey(work, index)},\n${fields.map(([key, value]) => `  ${key} = {${bibtexText(value)}}`).join(",\n")}\n}`;
  }).join("\n\n");
}
