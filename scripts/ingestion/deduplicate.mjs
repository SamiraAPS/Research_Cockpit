import { createHash } from "node:crypto";

import { analysisFields, evidenceTermsFor, normalizeDoi, normalizeTitle, unique } from "./normalize.mjs";

function authorSurnames(authors) {
  return (authors ?? []).flatMap((author) => {
    const name = normalizeTitle(author?.name);
    return name ? [name.split(" ").at(-1)] : [];
  }).filter(Boolean);
}

function compatibleDates(left, right) {
  const leftYear = Number(left?.slice(0, 4));
  const rightYear = Number(right?.slice(0, 4));
  return !leftYear || !rightYear || Math.abs(leftYear - rightYear) <= 1;
}

function sharedAuthor(left, right) {
  const a = authorSurnames(left);
  const b = new Set(authorSurnames(right));
  if (a.length === 0 || b.size === 0) return null;
  return a.some((name) => b.has(name));
}

function titleTokens(value) {
  return normalizeTitle(value).split(" ").filter((token) => token.length > 1);
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function editSimilarity(left, right) {
  if (left === right) return 1;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return 1 - row[right.length] / Math.max(left.length, right.length, 1);
}

function cautiousSimilarity(record, candidate) {
  const left = normalizeTitle(record.title);
  const right = normalizeTitle(candidate.title);
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.length < 5 || rightTokens.length < 5) return 0;
  if (Math.min(left.length, right.length) / Math.max(left.length, right.length) < 0.85) return 0;
  if (!compatibleDates(record.publicationDate, candidate.publicationDate)) return 0;
  const authorMatch = sharedAuthor(record.authors, candidate.authors);
  if (authorMatch === false) return 0;
  const score = Math.min(jaccard(leftTokens, rightTokens), editSimilarity(left, right));
  if (record.doi && candidate.doi && record.doi !== candidate.doi) {
    const differentVersions = record.sourceType === "preprint" !== (candidate.sourceType === "preprint");
    return differentVersions && authorMatch && score >= 0.97 ? score : 0;
  }
  if (authorMatch === null) return score >= 0.98 ? score : 0;
  return score >= 0.9 ? score : 0;
}

function exactTitleCompatible(record, candidate) {
  if (!compatibleDates(record.publicationDate, candidate.publicationDate)) return false;
  const authorMatch = sharedAuthor(record.authors, candidate.authors);
  if (authorMatch === false) return false;
  if (record.doi && candidate.doi && record.doi !== candidate.doi) {
    return Boolean(authorMatch) && (record.sourceType === "preprint" !== (candidate.sourceType === "preprint"));
  }
  return authorMatch !== null || titleTokens(record.title).length >= 5;
}

function externalEntries(record) {
  return Object.entries(record.externalIds ?? {}).filter(([, value]) => typeof value === "string" && value.length > 0);
}

function providerForStaticWork(work) {
  if (work.externalIds?.arxiv || /arxiv/i.test(work.source?.name ?? "")) return "arxiv";
  return "openalex";
}

export function staticWorkToRecord(work) {
  const provider = providerForStaticWork(work);
  const sourceRecordId = work.externalIds?.[provider] ?? work.source?.recordId ?? work.id;
  const discovered = work.discoveredBy?.[0];
  const record = {
    provider,
    mode: discovered?.mode ?? "existing",
    queryVersion: discovered?.queryVersion ?? "existing-static-data",
    sourceRecordId,
    externalIds: { ...(work.externalIds ?? {}) },
    doi: normalizeDoi(work.doi),
    normalizedTitle: normalizeTitle(work.title),
    title: work.title,
    abstract: work.abstract ?? null,
    authors: work.authors ?? [],
    venue: work.venue ?? null,
    sourceType: work.recordType === "preprint" ? "preprint" : work.versions?.find((version) => version.id === work.preferredVersionId)?.type ?? "journal",
    publicationDate: work.publicationDate ?? null,
    onlineDate: work.onlineDate ?? null,
    url: work.url ?? null,
    openAccess: work.openAccess ?? null,
    citedByCount: work.citedByCount ?? null,
    topics: work.topics ?? [],
    keywords: work.keywords ?? [],
    retrievedAt: work.lastVerifiedAt ?? work.retrievedAt,
    evidenceTerms: work.evidenceTerms ?? [],
    existingWork: work
  };
  if (record.evidenceTerms.length === 0) record.evidenceTerms = evidenceTermsFor(record);
  return record;
}

function richness(record) {
  return (record.existingWork ? 0 : 1)
    + (record.abstract ? 3 : 0)
    + Math.min(record.authors.length, 3)
    + (record.doi ? 2 : 0)
    + (record.onlineDate ? 1 : 0)
    + record.topics.length * 0.1;
}

const TYPE_PRIORITY = { journal: 3, proceedings: 2, preprint: 1 };

function preferredVariant(variants) {
  return [...variants].sort((left, right) =>
    TYPE_PRIORITY[right.sourceType] - TYPE_PRIORITY[left.sourceType]
    || richness(right) - richness(left)
    || String(right.retrievedAt).localeCompare(String(left.retrievedAt))
  )[0];
}

function addExternalId(target, provider, value) {
  if (!value || Object.values(target).includes(value)) return;
  if (!target[provider]) {
    target[provider] = value;
    return;
  }
  let index = 2;
  while (target[`${provider}${index}`]) index += 1;
  target[`${provider}${index}`] = value;
}

function versionFromRecord(record) {
  return {
    id: `${record.provider}:${record.sourceRecordId}`,
    type: record.sourceType,
    source: record.provider === "arxiv" ? "arXiv" : "OpenAlex",
    externalId: record.sourceRecordId,
    doi: record.doi,
    url: record.url
  };
}

function stableId(variants, externalIds, doi, normalizedTitleValue) {
  const existingId = variants.find((record) => record.existingWork?.id)?.existingWork.id;
  if (existingId) return existingId;
  if (doi) return `doi:${doi}`;
  if (externalIds.openalex) return `openalex:${externalIds.openalex}`;
  if (externalIds.arxiv) return `arxiv:${externalIds.arxiv}`;
  return `title:${createHash("sha256").update(normalizedTitleValue).digest("hex").slice(0, 20)}`;
}

function canonicalWork(group, context) {
  const variants = group.variants;
  const preferred = preferredVariant(variants);
  const externalIds = {};
  for (const variant of variants) {
    for (const [provider, value] of externalEntries(variant)) addExternalId(externalIds, provider, value);
    addExternalId(externalIds, variant.provider, variant.sourceRecordId);
  }
  const doi = preferred.doi ?? variants.find((variant) => variant.doi)?.doi ?? null;
  const allExistingVersions = variants.flatMap((variant) => variant.existingWork?.versions ?? []);
  const versions = [...allExistingVersions, ...variants.map(versionFromRecord)].filter((version, index, values) =>
    values.findIndex((candidate) => candidate.id === version.id) === index
  );
  const discoveredBy = [
    ...variants.flatMap((variant) => variant.existingWork?.discoveredBy ?? []),
    ...variants.filter((variant) => !variant.existingWork).map((variant) => ({
      provider: variant.provider,
      mode: variant.mode,
      queryVersion: variant.queryVersion
    }))
  ].filter((entry, index, values) => values.findIndex((candidate) =>
    candidate.provider === entry.provider && candidate.mode === entry.mode && candidate.queryVersion === entry.queryVersion
  ) === index);
  const abstract = preferred.abstract ?? variants.map((variant) => variant.abstract).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? null;
  const authors = [...variants].sort((left, right) => right.authors.length - left.authors.length)[0].authors;
  const topics = unique(variants.flatMap((variant) => variant.topics));
  const keywords = unique(variants.flatMap((variant) => variant.keywords));
  const combinedForAnalysis = { ...preferred, abstract, topics, keywords, evidenceTerms: unique(variants.flatMap((variant) => variant.evidenceTerms)) };
  const analysis = analysisFields(combinedForAnalysis);
  const freshVariants = variants.filter((variant) => !variant.existingWork);
  const failedProviders = context.failedProviders ?? new Set();
  const onlyFailedExisting = freshVariants.length === 0 && variants.some((variant) => failedProviders.has(variant.provider));
  const latestFresh = freshVariants.map((variant) => variant.retrievedAt).filter(Boolean).sort().at(-1);
  const latestExisting = variants.map((variant) => variant.existingWork?.lastVerifiedAt ?? variant.retrievedAt).filter(Boolean).sort().at(-1);
  const lastVerifiedAt = latestFresh ?? latestExisting ?? context.generatedAt;
  const preferredVersionId = versionFromRecord(preferred).id;

  return {
    id: stableId(variants, externalIds, doi, preferred.normalizedTitle),
    recordType: preferred.sourceType === "preprint" ? "preprint" : "publication",
    title: preferred.title,
    abstract,
    doi,
    externalIds,
    source: {
      name: preferred.provider === "arxiv" ? "arXiv" : "OpenAlex",
      recordId: preferred.sourceRecordId
    },
    venue: preferred.venue,
    publicationDate: preferred.publicationDate,
    onlineDate: preferred.onlineDate,
    topics,
    keywords,
    classifiedThemes: analysis.classifiedThemes,
    scores: analysis.scores,
    evidenceTerms: analysis.evidenceTerms,
    authors,
    url: preferred.url,
    openAccess: preferred.openAccess,
    citedByCount: variants.map((variant) => variant.citedByCount).filter(Number.isInteger).sort((a, b) => b - a)[0] ?? null,
    retrievedAt: variants.map((variant) => variant.retrievedAt).filter(Boolean).sort().at(-1) ?? context.generatedAt,
    dataStatus: onlyFailedExisting ? "stale" : "current",
    lastVerifiedAt,
    preferredVersionId,
    versions,
    discoveredBy
  };
}

export function deduplicateRecords(records, context = {}) {
  const groups = [];
  const doiIndex = new Map();
  const externalIndex = new Map();
  const titleIndex = new Map();
  const titleBuckets = new Map();
  const stats = { inputRecords: records.length, canonicalWorks: 0, mergedRecords: 0, doi: 0, externalId: 0, title: 0, fuzzyTitle: 0, versionLinks: 0 };

  function indexVariant(group, record) {
    if (record.doi) doiIndex.set(record.doi, group);
    for (const [provider, value] of externalEntries(record)) externalIndex.set(`${provider}:${value}`, group);
    externalIndex.set(`${record.provider}:${record.sourceRecordId}`, group);
    const exactGroups = titleIndex.get(record.normalizedTitle) ?? [];
    if (!exactGroups.includes(group)) exactGroups.push(group);
    titleIndex.set(record.normalizedTitle, exactGroups);
    const bucket = titleTokens(record.normalizedTitle).slice(0, 3).join(" ");
    if (bucket) {
      const bucketGroups = titleBuckets.get(bucket) ?? [];
      if (!bucketGroups.includes(group)) bucketGroups.push(group);
      titleBuckets.set(bucket, bucketGroups);
    }
  }

  for (const record of records) {
    let group = record.doi ? doiIndex.get(record.doi) : null;
    let method = group ? "doi" : null;
    if (!group) {
      for (const [provider, value] of externalEntries(record)) {
        group = externalIndex.get(`${provider}:${value}`);
        if (group) {
          method = "externalId";
          break;
        }
      }
    }
    if (!group) {
      group = externalIndex.get(`${record.provider}:${record.sourceRecordId}`);
      if (group) method = "externalId";
    }
    if (!group) {
      group = (titleIndex.get(record.normalizedTitle) ?? []).find((candidate) =>
        exactTitleCompatible(record, preferredVariant(candidate.variants))
      );
      if (group) method = "title";
    }
    if (!group) {
      const bucket = titleTokens(record.normalizedTitle).slice(0, 3).join(" ");
      group = (titleBuckets.get(bucket) ?? []).find((candidate) =>
        cautiousSimilarity(record, preferredVariant(candidate.variants)) > 0
      );
      if (group) method = "fuzzyTitle";
    }
    if (!group) {
      group = { variants: [] };
      groups.push(group);
    } else {
      stats[method] += 1;
      stats.mergedRecords += 1;
    }
    group.variants.push(record);
    indexVariant(group, record);
  }

  const works = groups.map((group) => canonicalWork(group, context));
  stats.canonicalWorks = works.length;
  stats.versionLinks = works.filter((work) => work.versions.some((version) => version.type === "preprint")
    && work.versions.some((version) => version.type !== "preprint")).length;
  works.sort((left, right) => String(right.publicationDate ?? "").localeCompare(String(left.publicationDate ?? "")) || left.title.localeCompare(right.title));
  return { works, stats };
}
