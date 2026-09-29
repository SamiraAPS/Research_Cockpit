import { createHash } from "node:crypto";
import { CORE_JOURNALS, CORE_CONFERENCES, STATIC_SEARCH_CONFIG_VERSION } from "../ingestion/config.mjs";
import { callTimeStatus } from "../../site/assets/js/research.js";
import { classifyRecord, normalizeAnalysisText } from "./classification.mjs";
import { THEMES } from "./ontology.v3.mjs";

export const RADAR_VERSION = "research-radar-1.0.0";
const day = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const dateOf = work => work.firstPublicDate ?? work.publicationDate;
const hasPreprint = work => work.recordType === "preprint" || work.versions?.some(version => version.type === "preprint");
const percent = (part, total) => total ? Math.round(part / total * 1000) / 10 : null;
const change = (a, b) => b >= 5 && a >= 5 ? Math.round((a - b) / b * 1000) / 10 : null;
const ids = works => works.slice(0, 12).map(work => work.id);
const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 12);

export function coverageFor(meta, area, from, to, modes = ["core", "broad", "frontier"]) {
  if (meta.retrievalState?.queryVersion !== STATIC_SEARCH_CONFIG_VERSION) return { complete: false, reason: "Für diese Suchversion liegt noch kein vollständiger Abrufnachweis vor." };
  const required = modes.flatMap(mode => (mode === "frontier" ? ["openalex", "arxiv"] : ["openalex"]).map(provider => `${provider}:${mode}`));
  const history = [...(meta.retrievalState.history ?? []), ...Object.values(meta.retrievalState.streams ?? {})];
  const missing = required.filter(stream => {
    const ranges = history.filter(row => `${row.provider}:${row.mode}` === stream && row.researchArea === area && row.complete).map(row => row.range).sort((a, b) => a.from.localeCompare(b.from));
    let cursor = Date.parse(from);
    for (const range of ranges) if (Date.parse(range.from) <= cursor && Date.parse(range.to) >= cursor) cursor = Date.parse(range.to) + day;
    return cursor <= Date.parse(to);
  });
  return { complete: missing.length === 0, reason: missing.length ? `Abrufabdeckung nicht nachgewiesen: ${missing.join(", ")}.` : "Geplante Abfragen in diesem Fenster vollständig abgerufen; Datenbankabdeckung und Relevanz bleiben unvalidiert." };
}

function counts(works) {
  return { count: works.length, preprints: works.filter(w => w.recordType === "preprint").length, withPreprintVersion: works.filter(hasPreprint).length, journals: works.filter(w => w.recordType !== "preprint" && !w.versions?.some(v => v.id === w.preferredVersionId && v.type === "proceedings")).length, proceedings: works.filter(w => w.recordType !== "preprint" && w.versions?.some(v => v.id === w.preferredVersionId && v.type === "proceedings")).length };
}

function authorGroups(works) {
  // Connected components: shared authors do NOT count as independent teams.
  const parent = works.map((_, i) => i), seen = new Map();
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  works.forEach((work, i) => (work.authors ?? []).forEach(author => {
    const key = author.orcid ?? author.id ?? normalizeAnalysisText(author.name);
    if (!key) return;
    if (seen.has(key)) parent[root(i)] = root(seen.get(key)); else seen.set(key, i);
  }));
  return new Set(works.flatMap((work, i) => work.authors?.length ? [root(i)] : [])).size;
}

export function duplicateCandidates(works) {
  const groups = new Map();
  for (const work of works) {
    const title = normalizeAnalysisText(work.title);
    if (title.split(" ").length < 6 || !work.authors?.length) continue;
    const key = `${title}:${normalizeAnalysisText(work.authors[0].name)}`;
    const group = groups.get(key) ?? [];
    group.push(work); groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => ({ id: `duplicate:${digest(group[0].title)}`, workIds: group.map(w => w.id), reason: "Identischer normalisierter Titel und erste Autorenschaft; Zusammenführung erfordert Versionsnachweis." }));
}

export function groupCalls(calls, generatedAt) {
  const groups = new Map();
  for (const call of calls.items ?? []) {
    const status = callTimeStatus(call, new Date(generatedAt));
    if (!["open", "closing-soon"].includes(status) || !call.lastVerifiedAt || new Date(generatedAt) - new Date(call.lastVerifiedAt) > 8 * day) continue;
    const year = call.title.match(/20\d{2}/)?.[0] ?? call.deadlineAt?.slice(0, 4) ?? "unknown";
    const key = `${call.sourceKey}:${year}`;
    const group = groups.get(key) ?? { id: key, sourceKey: call.sourceKey, venue: call.venue, calls: [], themes: new Set(), topicalCalls: [], deadlineAt: null };
    group.calls.push(call.id);
    if (call.deadlineAt && (!group.deadlineAt || call.deadlineAt < group.deadlineAt)) group.deadlineAt = call.deadlineAt;
    const title = call.title.replace(new RegExp(String(call.venue ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
    const topical = ["special_issue", "workshop"].includes(call.callType) && !/proposals?|call for workshops?|workshop submissions?/i.test(title);
    // Generic event descriptions and proximity of deadlines are not novelty evidence.
    const themes = topical ? classifyRecord({ title, abstract: call.callType === "special_issue" ? call.description : null }) : [];
    if (themes.length) { group.topicalCalls.push(call.id); themes.forEach(theme => group.themes.add(theme.theme)); }
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, themes: [...group.themes], signalKind: group.topicalCalls.length ? "thematic-agenda" : "general-event", verification: "official-source-checked; not human verified" }));
}

function timeSeries(works, meta, area, generatedAt) {
  const now = new Date(generatedAt), year = now.getUTCFullYear();
  const relevant = works.filter(w => w.research?.relevance.areas.includes(area) && dateOf(w) && dateOf(w) <= iso(now));
  const annual = [];
  for (let y = 2018; y <= year; y++) {
    const from = `${y}-01-01`, to = y === year ? iso(now) : `${y}-12-31`;
    const selected = relevant.filter(w => dateOf(w) >= from && dateOf(w) <= to);
    annual.push({ period: String(y), ...counts(selected), partialPeriod: y === year, coverage: coverageFor(meta, area, from, to), denominator: "canonical works in this retrieved research area; not worldwide publication totals" });
  }
  const monthly = [];
  for (let offset = 23; offset >= 0; offset--) {
    const from = iso(Date.UTC(year, now.getUTCMonth() - offset, 1));
    const end = iso(Date.UTC(year, now.getUTCMonth() - offset + 1, 0));
    const to = end > iso(now) ? iso(now) : end;
    monthly.push({ period: from.slice(0, 7), ...counts(relevant.filter(w => dateOf(w) >= from && dateOf(w) <= to)), partialPeriod: offset === 0, coverage: coverageFor(meta, area, from, to) });
  }
  // Adjacent COMPLETE calendar quarters; current partial quarter is only displayed monthly.
  const quarterStart = Date.UTC(year, Math.floor(now.getUTCMonth() / 3) * 3, 1);
  const currentQuarter = new Date(quarterStart);
  const recentFrom = iso(Date.UTC(currentQuarter.getUTCFullYear(), currentQuarter.getUTCMonth() - 3, 1));
  const previousFrom = iso(Date.UTC(currentQuarter.getUTCFullYear(), currentQuarter.getUTCMonth() - 6, 1));
  const recentTo = iso(quarterStart - day), previousTo = iso(Date.parse(recentFrom) - day);
  const recent = relevant.filter(w => dateOf(w) >= recentFrom && dateOf(w) <= recentTo);
  const previous = relevant.filter(w => dateOf(w) >= previousFrom && dateOf(w) <= previousTo);
  const comparable = coverageFor(meta, area, previousFrom, recentTo).complete;
  const themes = THEMES.map(theme => {
    const matches = rows => rows.filter(w => w.classifiedThemes.some(t => t.theme === theme.id));
    const a = matches(recent), b = matches(previous);
    const normalizedChange = b.length >= 5 && a.length >= 5 && recent.length && previous.length ? Math.round(((a.length / recent.length) / (b.length / previous.length) - 1) * 1000) / 10 : null;
    return { theme: theme.id, label: theme.label, recent: counts(a), previous: counts(b), recentDenominator: recent.length, previousDenominator: previous.length, observedCountChangePercent: change(a.length, b.length), observedShareChangePercent: normalizedChange, interpretation: comparable && a.length >= 5 && b.length >= 5 ? "descriptive-only" : "insufficient-coverage-or-count", preprintShare: percent(a.filter(hasPreprint).length, a.length), authorGroups: authorGroups(a), venues: new Set(a.map(w => w.venue).filter(Boolean)).size, evidenceWorkIds: ids(a) };
  });
  return { area, annual, monthly, comparison: { recentFrom, recentTo, previousFrom, previousTo, comparable, themes } };
}

const STOP = new Set("the a an and or of to in on for with from by as is are was were be been this that we our their its at into using use used study paper research results findings based approach new ai human artificial intelligence learning model models system systems data participants can may it not between towards through about support effect effects analysis evaluation design".split(" "));
function features(work) {
  const tokens = normalizeAnalysisText(`${work.title} ${work.title} ${(work.abstract ?? "").slice(0, 2000)}`).split(" ");
  const values = tokens.filter(t => t.length > 3 && !STOP.has(t));
  // Add context synonyms as shared concept features, but keep open-vocabulary terms.
  for (const [field, entries] of Object.entries(work.research?.fields ?? {})) entries.forEach(entry => values.push(`${field}:${entry.value}`, `${field}:${entry.value}`));
  return values;
}

export function discoverClusters(works, generatedAt, agenda, semanticEntries = {}) {
  const now = new Date(generatedAt), start = iso(now.getTime() - 365 * day);
  const candidates = works.filter(w => w.research?.relevance.status === "included" && dateOf(w) >= start && dateOf(w) <= iso(now)).sort((a, b) => a.id.localeCompare(b.id));
  const df = new Map(), tokenLists = candidates.map(features);
  for (const tokens of tokenLists) for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  const groups = [];
  candidates.forEach((work, index) => {
    const tf = new Map(); for (const token of tokenLists[index]) tf.set(token, (tf.get(token) ?? 0) + 1);
    const vector = [...tf].filter(([t]) => df.get(t) >= 3 && (candidates.length <= 20 || df.get(t) < candidates.length * 0.5)).map(([t, n]) => [t, (1 + Math.log(n)) * Math.log(1 + candidates.length / df.get(t))]).sort((a, b) => b[1] - a[1]).slice(0, 35);
    const norm = Math.hypot(...vector.map(([, v]) => v)) || 1;
    const normalized = new Map(vector.map(([t, v]) => [t, v / norm]));
    if (!normalized.size) return;
    const semantic = semanticEntries[work.id];
    const embedded = semantic?.embedding;
    const embeddingNorm = embedded ? Math.hypot(...embedded) : 0;
    const semanticVector = embeddingNorm ? embedded.map(v => v / embeddingNorm) : null;
    let best = null, similarity = semanticVector ? 0.78 : 0.30;
    for (const group of groups) {
      if (Boolean(semanticVector) !== Boolean(group.embedding)) continue;
      if (semanticVector && (group.embedding.length !== semanticVector.length || group.embeddingModel !== semantic.embeddingModel)) continue;
      const dot = semanticVector ? semanticVector.reduce((sum, value, i) => sum + value * group.embedding[i], 0) / group.embeddingNorm : [...normalized].reduce((n, [t, v]) => n + v * (group.centroid.get(t) ?? 0), 0) / group.norm;
      if (dot > similarity) { best = group; similarity = dot; }
    }
    if (!best) { groups.push({ centroid: normalized, norm: 1, works: [work], embedding: semanticVector, embeddingNorm: semanticVector ? 1 : 0, embeddingModel: semantic?.embeddingModel }); return; }
    if (semanticVector) { best.embedding = best.embedding.map((v, i) => v + semanticVector[i]); best.embeddingNorm = Math.hypot(...best.embedding); }
    for (const [t, v] of normalized) best.centroid.set(t, (best.centroid.get(t) ?? 0) + v);
    best.norm = Math.hypot(...best.centroid.values()); best.works.push(work);
  });
  return groups.filter(group => group.works.length >= 3).map(group => {
    const keywords = [...group.centroid].filter(([t]) => !t.includes(":" )).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    const themes = [...new Set(group.works.flatMap(w => w.classifiedThemes.map(t => t.theme)))];
    const recent = group.works.filter(w => dateOf(w) >= iso(now.getTime() - 90 * day));
    const previous = group.works.filter(w => dateOf(w) < iso(now.getTime() - 90 * day) && dateOf(w) >= iso(now.getTime() - 180 * day));
    const authorGroupCount = authorGroups(group.works);
    return { id: `cluster:${digest(keywords.join(" ") + group.works[0].id)}`, label: keywords.join(" · "), method: group.embedding ? "semantic-embedding" : "text-context", embeddingModel: group.embeddingModel ?? null, keywords, workCount: group.works.length, recentCount: recent.length, previousCount: previous.length, preprintCount: group.works.filter(hasPreprint).length, authorGroups: authorGroupCount, venueCount: new Set(group.works.map(w => w.venue).filter(Boolean)).size, status: authorGroupCount >= 2 ? "candidate" : "single-author-network", evidenceWorkIds: ids([...group.works].sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a))))), agendaEventIds: agenda.filter(event => event.themes.some(t => themes.includes(t))).map(event => event.id), caveat: "Exploratives Cluster; weder Neuheit noch Zukunftswachstum bestätigt. Autorengruppen sind eine konservative Näherung, keine institutionelle Unabhängigkeit." };
  }).sort((a, b) => b.recentCount - a.recentCount || b.authorGroups - a.authorGroups).slice(0, 20);
}

const DESIGNS = {
  learning: ["Unterstützt reflektierende KI gegenüber einer lösungsgebenden KI den Lerntransfer nach Entzug der KI?", "Randomisierte Aufgabenstudie mit verzögertem Transfer ohne KI; Vorwissen, Aufgabenleistung und Reflexion erfassen."],
  motivation: ["Wie verändert die Wahlfreiheit über KI-Unterstützung intrinsische Motivation und selbstständige Aufgabenbearbeitung?", "Vergleich frei gewählter und vorgegebener KI-Unterstützung; Motivation, Autonomieerleben und spätere freiwillige Nutzung erfassen."],
  cognition: ["Wann entlastet KI die Arbeit, während aktive Prüfung und Situationsverständnis erhalten bleiben?", "Faktorielles Experiment mit unterschiedlichen Automationsgraden und Fehlerraten; mentale Belastung, Fehlerentdeckung und Situationsverständnis messen."],
  agency: ["Welche Eingriffsmöglichkeiten erhalten menschliche Kontrolle bei KI-gestützter Arbeit?", "Vergleich von übersteuerbarer und starrer Unterstützung; tatsächliche Eingriffe, Autonomieerleben und Leistung erfassen."],
  trust: ["Welche Rückmeldungen unterstützen angemessene Reliance auch bei wechselnder KI-Zuverlässigkeit?", "Wiederholte Aufgaben mit wechselnder Systemzuverlässigkeit; Reliance, Fehlerkorrektur und Kalibrierung über die Zeit vergleichen."],
  teaming: ["Wie verändern KI-Rollen gemeinsame Abstimmung und menschlichen Kompetenzerhalt?", "Teamstudie mit wechselnden KI-Rollen; Kommunikationsprozesse, geteiltes Verständnis und Leistung nach Wegfall der KI erfassen."],
  safety: ["Welche KI-Unterstützung verbessert Fehlererkennung, ohne die menschliche Überwachung zu schwächen?", "Sicherheitskritische Simulation mit seltenen Fehlern; Entdeckungsrate, Reaktionszeit und Überwachungsverhalten vergleichen."],
  participation: ["Verbessert die Beteiligung Beschäftigter an der KI-Einführung die spätere Arbeitsgestaltung?", "Längsschnittvergleich partizipativer und zentraler Einführung; Arbeitsautonomie, Akzeptanz und tatsächliche Aufgabenveränderungen erheben."]
};

function ideaCards(works, agenda) {
  return THEMES.flatMap(theme => {
    const relevant = works.filter(w => w.research?.relevance.status === "included" && w.classifiedThemes.some(t => t.theme === theme.id));
    if (relevant.length < 3) return [];
    const fit = relevant.filter(w => w.research.personalFit.length);
    const evidence = [...relevant].sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a)))).slice(0, 5);
    const design = DESIGNS[theme.id];
    if (!design) return [];
    return [{ id: `idea:${theme.id}`, theme: theme.id, label: theme.label, status: "hypothesis-for-review", observation: `${relevant.length} relevante Korpusarbeiten enthalten Textbelege zu ${theme.label}; darunter ${relevant.filter(hasPreprint).length} mit Preprint-Version.`, question: design[0], proposedDesign: design[1], unresolved: "Ob diese Frage bereits beantwortet ist oder widersprüchliche Ergebnisse vorliegen, erfordert eine Prüfung der Volltexte. Häufigkeit allein belegt keine Forschungslücke.", counterarguments: ["Die vorgeschlagene Wirkung könnte von Vorwissen, Aufgabe und KI-Zuverlässigkeit abhängen.", "Publikations- und Indexierungseffekte können ein vermeintliches Signal erzeugen."], evidence: evidence.map(w => ({ workId: w.id, quote: w.classifiedThemes.find(t => t.theme === theme.id)?.evidence.find(e => ["title", "abstract"].includes(e.source))?.sourceValue ?? w.title })), personalFitCount: fit.length, matchedEvents: agenda.filter(event => event.themes.includes(theme.id)).map(event => event.id), noveltyVerified: false }];
  }).sort((a, b) => b.personalFitCount - a.personalFitCount);
}

export function buildResearchRadar(works, calls, meta, generatedAt, semanticEntries = {}) {
  const agenda = groupCalls(calls, generatedAt);
  const duplicates = duplicateCandidates(works);
  const venues = [...CORE_JOURNALS, ...CORE_CONFERENCES, ...(meta.conferenceRegistry?.sources ?? [])];
  const uniqueVenues = [...new Map(venues.map(v => [v.name, v])).values()];
  const coverage = uniqueVenues.map(venue => {
    const rows = works.filter(w => normalizeAnalysisText(w.venue) === normalizeAnalysisText(venue.name));
    return { venue: venue.name, sourceId: venue.id, countsByYear: Object.fromEntries([...new Set(rows.map(w => w.publicationDate?.slice(0, 4)).filter(Boolean))].sort().map(year => [year, rows.filter(w => w.publicationDate?.startsWith(year)).length])), latestPublicationDate: rows.map(w => w.publicationDate).filter(Boolean).sort().at(-1) ?? null, abstractMissing: rows.filter(w => !w.abstract).length, status: rows.length ? "observed-only" : "no-records-observed" };
  });
  return { schemaVersion: RADAR_VERSION, generatedAt, queryVersion: meta.queryVersion, method: { classification: "text-supported rules; metadata keywords not independent evidence", clusters: "deterministic TF-IDF cosine clustering with context synonyms; not an LLM", prediction: "No validated forecasting model. Signals are research leads, not predictions.", dates: "Earliest known public version where available; legacy records may only have the preferred version date.", uncertainty: "Changing retrieval coverage, suspected duplicates and missing abstracts affect counts. No worldwide field-size claim." }, relevance: Object.fromEntries(["included", "uncertain", "excluded"].map(status => [status, works.filter(w => w.research?.relevance.status === status).length])), series: ["human-factors", "human-ai"].map(area => timeSeries(works, meta, area, generatedAt)), agenda, semanticCoverage: { extracted: Object.keys(semanticEntries).length, total: works.length }, clusters: discoverClusters(works, generatedAt, agenda, semanticEntries), ideas: ideaCards(works, agenda), sourceCoverage: coverage, duplicateCandidates: duplicates, validation: { manuallyValidated: false, precision: null, recall: null, forecastBacktest: "pending comparable historical snapshots" } };
}
