export function validateResearchData(parsed) {
  const errors = [];
  const error = (file, path, message) => errors.push({ code: "invalid-research-data", file, path, message });
  const pages = [...parsed].filter(([name]) => /^works\/page-\d+\.json$/.test(name));
  const works = pages.flatMap(([, page]) => page.items ?? []), byId = new Map(works.map(work => [work.id, work]));
  for (const [file, page] of pages) for (const [i, work] of (page.items ?? []).entries()) {
    const research = work.research;
    if (!research) continue;
    if (research.methodVersion !== "research-evidence-1.0.0" || !["included", "uncertain", "excluded"].includes(research.relevance?.status) || !Array.isArray(research.personalFit) || !research.fields || research.validation !== "not-human-validated") error(file, `/items/${i}/research`, "Forschungsvertrag oder Validierungsstatus ungültig");
    const check = value => {
      if (!value || typeof value !== "object") return;
      if (Object.hasOwn(value, "quote") && Object.hasOwn(value, "start")) {
        if (!["title", "abstract"].includes(value.field) || !Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end <= value.start || value.quote !== String(work[value.field] ?? "").slice(value.start, value.end)) error(file, `/items/${i}/research`, "Textbeleg stimmt nicht mit Original und Position überein");
      }
      Object.values(value).forEach(check);
    };
    check(research);
    for (const claim of research.semantic?.claims ?? []) if (!["title", "abstract"].includes(claim.source) || typeof claim.quote !== "string" || claim.quote.length < 10 || !String(work[claim.source] ?? "").includes(claim.quote)) error(file, `/items/${i}/research/semantic`, "KI-Behauptung ohne Originaltextbeleg");
  }
  const radar = parsed.get("research-radar.json"), meta = parsed.get("meta.json");
  for (const series of meta?.fieldCounts?.series ?? []) {
    if (!["human-ai", "human-factors"].includes(series.area) || !["ready", "stale", "unavailable"].includes(series.status)) error("meta.json", "/fieldCounts", "Ungültiger Zählbereich oder Status");
    for (const point of series.annual ?? []) if (!Number.isInteger(point.count) || !Number.isInteger(point.preprints) || point.count < point.preprints || point.preprints < 0) error("meta.json", "/fieldCounts", "Inkonsistente Datenbankzählung");
  }
  if (radar) {
    if (radar.schemaVersion !== "research-radar-1.0.0" || radar.generatedAt !== meta?.generatedAt) error("research-radar.json", "/", "Schema oder Generationszeit stimmt nicht");
    for (const key of ["series", "clusters", "ideas", "agenda", "sourceCoverage", "duplicateCandidates"]) if (!Array.isArray(radar[key])) error("research-radar.json", `/${key}`, "Array fehlt");
    const callIds = new Set((parsed.get("calls.json")?.items ?? []).map(call => call.id));
    const events = new Set((radar.agenda ?? []).map(event => event.id));
    const checkIds = (ids, kind, pointer) => { if (!Array.isArray(ids) || ids.some(id => !(kind === "work" ? byId : kind === "call" ? callIds : events).has(id))) error("research-radar.json", pointer, "Unbekannte Evidenz-ID"); };
    for (const cluster of radar.clusters ?? []) { checkIds(cluster.evidenceWorkIds, "work", "/clusters"); checkIds(cluster.agendaEventIds, "event", "/clusters"); }
    for (const idea of radar.ideas ?? []) { checkIds((idea.evidence ?? []).map(e => e.workId), "work", "/ideas"); if (idea.noveltyVerified !== false) error("research-radar.json", "/ideas", "Automatische Ideen dürfen nicht als neuheitsverifiziert gelten"); }
    for (const event of radar.agenda ?? []) checkIds(event.calls, "call", "/agenda");
    for (const series of radar.series ?? []) for (const point of [...(series.annual ?? []), ...(series.monthly ?? [])]) {
      if (!Number.isInteger(point.count) || point.count < 0 || point.journals + point.preprints + point.proceedings !== point.count || typeof point.coverage?.complete !== "boolean") error("research-radar.json", "/series", "Inkonsistente Anzahl oder Abdeckung");
    }
    if (radar.validation?.manuallyValidated !== false || radar.validation.precision !== null || radar.validation.recall !== null) error("research-radar.json", "/validation", "Manuelle Validierung darf nicht vorgetäuscht werden");
  }
  const search = parsed.get("search-index.json");
  if (search?.schemaVersion === "search-index-2.0.0") {
    const indexed = new Set();
    for (const shard of search.shards ?? []) {
      if (!/^\.\/search\/shard-\d+\.json$/.test(shard.path)) { error("search-index.json", "/shards", "Ungültiger Shard-Pfad"); continue; }
      const file = shard.path.slice(2), data = parsed.get(file);
      if (!data || data.schemaVersion !== "search-shard-1.0.0" || data.generatedAt !== search.generatedAt || data.documents?.length !== shard.count) { error(file, "/", "Shard fehlt oder Generation/Anzahl inkonsistent"); continue; }
      for (const doc of data.documents) {
        const work = byId.get(doc.id);
        if (!work || indexed.has(doc.id) || doc.abstract !== work.abstract || JSON.stringify(doc.topics) !== JSON.stringify(work.topics) || JSON.stringify(doc.keywords) !== JSON.stringify(work.keywords)) error(file, "/documents", "Suchtext stimmt nicht mit Works überein oder doppelte ID");
        indexed.add(doc.id);
      }
    }
    if (indexed.size !== works.length) error("search-index.json", "/shards", "Shards decken den Korpus nicht vollständig ab");
  }
  return errors;
}
