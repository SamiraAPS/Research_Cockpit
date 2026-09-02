import type { RadarCorpusWork } from "@/app/radar-types";

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function worksToCsv(works: RadarCorpusWork[]) {
  const headers = [
    "id", "title", "authors", "doi", "source", "publication_date", "type", "url",
    "open_access", "citations", "themes", "search_layers", "abstract", "retrieved_at", "data_status",
  ];
  const rows = works.map((work) => [
    work.id, work.title, work.authors.join("; "), work.doi, work.source, work.publicationDate,
    work.sourceType, work.url, work.isOpenAccess ? "yes" : "no", work.citedBy,
    work.themes.join("; "), work.searchLayers.join("; "), work.abstract, work.retrievedAt, work.dataStatus,
  ].map(csvCell).join(","));
  return `\uFEFF${headers.map(csvCell).join(",")}\n${rows.join("\n")}\n`;
}

export function worksToAuditCsv(
  works: RadarCorpusWork[],
  context: { methodologyVersion: string; goldStandardVersion: string; queryVersion: string },
) {
  const headers = [
    "gold_standard_version", "methodology_version", "query_version", "work_id", "title", "authors",
    "doi", "source", "publication_date", "publication_type", "url", "search_layers", "themes",
    "abstract", "retrieved_at", "manual_label", "manual_note", "review_status",
  ];
  const rows = works.map((work) => [
    context.goldStandardVersion,
    context.methodologyVersion,
    context.queryVersion,
    work.id,
    work.title,
    work.authors.join("; "),
    work.doi,
    work.source,
    work.publicationDate,
    work.sourceType,
    work.url,
    work.searchLayers.join("; "),
    work.themes.join("; "),
    work.abstract,
    work.retrievedAt,
    "",
    "",
    "pending_manual_review",
  ].map(csvCell).join(","));
  return `\uFEFF${headers.map(csvCell).join(",")}\n${rows.join("\n")}\n`;
}

function bibValue(value: string) {
  return value
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_");
}

function citationKey(work: RadarCorpusWork) {
  const author = work.authors[0]?.split(/\s+/).at(-1) ?? "Radar";
  const year = work.publicationDate.slice(0, 4) || "nd";
  const suffix = work.id.replace(/[^a-z0-9]/gi, "").slice(-6) || "work";
  return `${author}${year}${suffix}`.replace(/[^a-z0-9]/gi, "");
}

export function worksToBibtex(works: RadarCorpusWork[]) {
  return works.map((work) => {
    const kind = work.sourceType === "journal" ? "article" : work.sourceType === "proceedings" ? "inproceedings" : "misc";
    const venueField = work.sourceType === "journal" ? "journal" : work.sourceType === "proceedings" ? "booktitle" : "howpublished";
    const fields = [
      ["title", work.title],
      ["author", work.authors.join(" and ")],
      ["year", work.publicationDate.slice(0, 4)],
      [venueField, work.source],
      ["doi", work.doi],
      ["url", work.url],
      ["abstract", work.abstract],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    return `@${kind}{${citationKey(work)},\n${fields.map(([key, value]) => `  ${key} = {${bibValue(value)}}`).join(",\n")}\n}`;
  }).join("\n\n");
}
