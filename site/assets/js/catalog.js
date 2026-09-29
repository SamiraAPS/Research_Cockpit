// The initial catalog omits abstracts and repeated provenance. Details and full
// text remain available in separate, generation-stamped JSON files.
export function catalogDocument(work) {
  const preferred = work.versions?.find(v => v.id === work.preferredVersionId);
  return { id: work.id, recordType: work.recordType, title: work.title, abstract: null,
    authors: work.authors.map(a => a.name), venue: work.venue, publicationDate: work.publicationDate,
    topics: [], keywords: [], themes: work.classifiedThemes.map(t => t.theme), evidenceTerms: [], url: work.url,
    pagePath: work.pagePath,
    summary: { kind: preferred?.type ?? (work.recordType === "preprint" ? "preprint" : "journal"), doi: work.doi,
      sourceName: work.source?.name, firstSeenAt: work.firstSeenAt, firstSeenRunId: work.firstSeenRunId,
      citedByCount: work.citedByCount, dataStatus: work.dataStatus,
      modes: [...new Set((work.discoveredBy ?? []).map(d => d.mode))],
      providers: [...new Set((work.discoveredBy ?? []).map(d => d.provider))],
      areas: work.research?.relevance.areas ?? [], relevance: work.research?.relevance.status ?? "uncertain",
      personalFit: work.research?.personalFit.map(f => f.topic) ?? [] }
  };
}

export function catalogWork(doc, themeLabels = {}) {
  if (!doc.summary?.kind) return { ...doc.summary, pagePath: doc.pagePath, _summary: true };
  const s = doc.summary;
  return { ...doc, authors: doc.authors.map(name => ({ name })), source: { name: s.sourceName },
    doi: s.doi, firstSeenAt: s.firstSeenAt, firstSeenRunId: s.firstSeenRunId, citedByCount: s.citedByCount,
    dataStatus: s.dataStatus, preferredVersionId: "preferred", versions: [{ id: "preferred", type: s.kind }],
    discoveredBy: [...s.modes.map(mode => ({ mode })), ...s.providers.map(provider => ({ provider }))],
    classifiedThemes: doc.themes.map(theme => ({ theme, label: themeLabels[theme] ?? theme, evidence: [] })),
    research: { relevance: { areas: s.areas, status: s.relevance }, personalFit: s.personalFit.map(topic => ({ topic })) },
    _summary: true };
}
