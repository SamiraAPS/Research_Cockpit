"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight, BookMarked, CalendarDays, Database, Download, FileText, Search, Star,
} from "lucide-react";

import type {
  CorpusMode,
  CorpusSort,
  RadarCorpusResponse,
  RadarCorpusWork,
  SearchLayer,
} from "@/app/radar-types";
import type { ShortlistControls } from "@/app/use-shortlist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const THEME_LABELS: Record<string, string> = {
  learning: "Lernen", trust: "Vertrauen", agency: "Agency", cognition: "Kognition",
  teaming: "Teaming", motivation: "Motivation", safety: "Sicherheit", participation: "Partizipation",
};

const EVIDENCE_LABELS = {
  title: "Titel", abstract: "Abstract", keyword: "Keyword", openalex_topic: "OpenAlex Topic",
} as const;

const SOURCE_KIND_LABELS: Record<RadarCorpusWork["sourceKind"], string> = {
  journal: "Journal", conference: "Konferenz", repository: "Repository",
};

const DATA_STATUS_LABELS = {
  live: "Lauf erfolgreich", partial: "Lauf teilweise", unavailable: "Lauf nicht verfügbar",
} as const;

function formatDate(value: string) {
  if (!value) return "Datum nicht ausgewiesen";
  return new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function publicationTypeLabel(work: RadarCorpusWork) {
  if (work.sourceType === "preprint") return "Preprint";
  if (work.sourceType === "proceedings") return "Proceedings";
  return "Peer-reviewed";
}

function EmptyCorpus({ title, message }: { title: string; message: string }) {
  return <div className="empty-state corpus-empty"><Search aria-hidden="true" /><h3>{title}</h3><p>{message}</p></div>;
}

export function PublicationCard({
  work,
  shortlist,
  compact = false,
}: {
  work: RadarCorpusWork;
  shortlist: ShortlistControls;
  compact?: boolean;
}) {
  const selected = shortlist.ids.has(work.id);
  return <article className={`work-row corpus-work-row ${compact ? "compact" : ""}`}>
    <div className="work-type-rail" data-type={work.sourceType} />
    <div className="work-main">
      <div className="work-meta-row">
        <Badge className={work.sourceType === "preprint" ? "preprint-badge" : "journal-badge"}>{publicationTypeLabel(work)}</Badge>
        <span>{SOURCE_KIND_LABELS[work.sourceKind]} · {work.source}</span>
        <span className="meta-divider">•</span><span>{formatDate(work.publicationDate)}</span>
        <span className={`publication-data-state ${work.dataStatus}`}><span />{DATA_STATUS_LABELS[work.dataStatus]}</span>
      </div>
      <div className="publication-title-row">
        <a href={work.url} target="_blank" rel="noreferrer" className="work-title">{work.title}<ArrowUpRight aria-hidden="true" /></a>
        <Button
          type="button"
          size="icon-sm"
          variant={selected ? "default" : "outline"}
          className="shortlist-toggle"
          aria-label={selected ? `„${work.title}“ aus Shortlist entfernen` : `„${work.title}“ zur Shortlist hinzufügen`}
          aria-pressed={selected}
          disabled={!shortlist.ready || shortlist.saving || shortlist.storage === "unavailable"}
          onClick={() => void shortlist.toggle(work.id)}
        ><Star aria-hidden="true" className={selected ? "shortlist-starred" : ""} /></Button>
      </div>
      {work.authors.length > 0 && <p className="work-authors">{work.authors.join(", ")}{work.authors.length === 4 ? " et al." : ""}</p>}
      <dl className="publication-identifiers">
        <div><dt>DOI</dt><dd>{work.doi ? <a href={`https://doi.org/${work.doi}`} target="_blank" rel="noreferrer">{work.doi}</a> : "Nicht vorhanden"}</dd></div>
        <div><dt>Zitationen</dt><dd>{work.citedBy}</dd></div>
        <div><dt>Suchschicht</dt><dd>{work.searchLayers.length ? work.searchLayers.join(" · ") : "Nicht ausgewiesen"}</dd></div>
        <div><dt>Abruf</dt><dd>{formatDateTime(work.retrievedAt)}</dd></div>
      </dl>
      <p className={`abstract-excerpt ${compact ? "compact" : ""}`}><strong>Abstract:</strong> {work.abstract ?? "Kein Abstract in den gespeicherten Metadaten vorhanden."}</p>
      <div className="theme-row">
        {work.themes.map((theme) => <span key={theme} className={`theme-chip theme-${theme}`}>{THEME_LABELS[theme] ?? theme}</span>)}
        {work.isOpenAccess && <span className="oa-chip">Open Access</span>}
        {work.emergingSignal.rank > 0 && <span className="emerging-chip">Emerging: {work.emergingSignal.status}</span>}
      </div>
      {!compact && work.themeClassifications.length > 0 && <div className="theme-evidence-block">
        <p>Themenzuordnung · gespeicherte Evidenz</p>
        {work.themeClassifications.map((classification) => <div className="theme-evidence-row" key={classification.theme}>
          <strong>{classification.label}<span>Score {classification.score}</span></strong>
          <span>{classification.evidence.map((evidence) => `${EVIDENCE_LABELS[evidence.source]}: „${evidence.matchedTerm}“ (+${evidence.weight})`).join(" · ")}</span>
        </div>)}
        <small>Klassifikation {work.themeClassifications[0]?.classificationVersion} · Ontologie {work.themeClassifications[0]?.ontologyVersion}</small>
      </div>}
    </div>
    {!compact && <div className="relevance-wrap"><div className="relevance-score" aria-label={`Regelbasiertes Relevanzsignal ${work.relevanceScore} von 100`}>{work.relevanceScore}</div><small>regelbasiert</small></div>}
  </article>;
}

type CorpusFilters = {
  layer: "all" | SearchLayer;
  venueKind: "all" | RadarCorpusWork["sourceKind"];
  venue: string;
  theme: string;
  publicationType: "all" | RadarCorpusWork["sourceType"];
  period: "all" | "1" | "3" | "5" | "10";
  workDomain: string;
  studyType: string;
};

const DEFAULT_FILTERS: CorpusFilters = {
  layer: "all", venueKind: "all", venue: "all", theme: "all", publicationType: "all",
  period: "all", workDomain: "all", studyType: "unavailable",
};

function buildCorpusParams(input: {
  scope: "ai" | "field";
  page: number;
  query: string;
  filters: CorpusFilters;
  sort: CorpusSort;
  mode: CorpusMode;
  shortlistIds: Set<string>;
}) {
  const params = new URLSearchParams({ scope: input.scope, page: String(input.page), pageSize: "10", sort: input.sort, mode: input.mode });
  if (input.query) params.set("q", input.query);
  if (input.filters.layer !== "all") params.set("layer", input.filters.layer);
  if (input.filters.venueKind !== "all") params.set("venueKind", input.filters.venueKind);
  if (input.filters.venue !== "all") params.set("venue", input.filters.venue);
  if (input.filters.theme !== "all") params.set("theme", input.filters.theme);
  if (input.filters.publicationType !== "all") params.set("publicationType", input.filters.publicationType);
  if (input.filters.workDomain !== "all") params.set("workDomain", input.filters.workDomain);
  if (input.filters.period !== "all") {
    const currentYear = new Date().getUTCFullYear();
    params.set("fromYear", String(currentYear - Number(input.filters.period) + 1));
    params.set("toYear", String(currentYear));
  }
  if (input.mode === "shortlist") params.set("ids", [...input.shortlistIds].join(","));
  return params;
}

function CorpusLoading() {
  return <div className="corpus-loading" aria-label="Gespeicherter Korpus wird geladen" aria-live="polite">
    <Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" />
  </div>;
}

export function CorpusBrowser({ scope, shortlist }: { scope: "ai" | "field"; shortlist: ShortlistControls }) {
  const [mode, setMode] = useState<CorpusMode>("new");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CorpusFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<CorpusSort>("date");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RadarCorpusResponse | null>(null);
  const [settledRequest, setSettledRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => { setQuery(queryDraft.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timeout);
  }, [queryDraft]);

  const params = useMemo(() => buildCorpusParams({ scope, page, query, filters, sort, mode, shortlistIds: shortlist.ids }), [filters, mode, page, query, scope, shortlist.ids, sort]);
  const requestKey = params.toString();
  const loading = settledRequest !== requestKey;

  useEffect(() => {
    if (mode === "shortlist" && !shortlist.ready) return;
    const controller = new AbortController();
    fetch(`/api/works?${requestKey}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Der gespeicherte Forschungskorpus konnte nicht geladen werden.");
        return response.json() as Promise<RadarCorpusResponse>;
      })
      .then((payload) => { setData(payload); setError(null); setSettledRequest(requestKey); })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Unbekannter Korpusfehler");
        setSettledRequest(requestKey);
      });
    return () => controller.abort();
  }, [mode, requestKey, shortlist.ready]);

  const changeFilter = <Key extends keyof CorpusFilters>(key: Key, value: CorpusFilters[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const changeMode = (value: CorpusMode) => { setMode(value); setPage(1); };
  const exportUrl = (format: "csv" | "bibtex") => {
    const exportParams = new URLSearchParams(params);
    exportParams.delete("page");
    exportParams.delete("pageSize");
    exportParams.set("format", format);
    return `/api/works/export?${exportParams}`;
  };
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setQueryDraft(""); setQuery(""); setSort("date"); setPage(1); };

  return <section className="corpus-workspace">
    <div className="corpus-view-switch" role="group" aria-label="Publikationsansicht">
      <Button type="button" size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => changeMode("new")}>Neu seit letztem Lauf</Button>
      <Button type="button" size="sm" variant={mode === "all" ? "default" : "outline"} onClick={() => changeMode("all")}>Gesamter Korpus</Button>
      <Button type="button" size="sm" variant={mode === "weekly" ? "default" : "outline"} onClick={() => changeMode("weekly")}><CalendarDays />Wochen-Shortlist</Button>
      <Button type="button" size="sm" variant={mode === "shortlist" ? "default" : "outline"} onClick={() => changeMode("shortlist")}><BookMarked />Meine Shortlist ({shortlist.ids.size})</Button>
    </div>

    <section className="panel corpus-controls" aria-label="Korpus durchsuchen und filtern">
      <div className="corpus-search-row">
        <label className="search-box corpus-search"><Search aria-hidden="true" /><span className="sr-only">Gesamten Korpus durchsuchen</span><Input aria-label="Gesamten Korpus durchsuchen" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Titel, Abstract, Autor:in, DOI oder Quelle" /></label>
        <Select value={sort} onValueChange={(value) => { setSort(value as CorpusSort); setPage(1); }}><SelectTrigger aria-label="Publikationen sortieren"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="date">Datum</SelectItem><SelectItem value="relevance">Relevanz</SelectItem><SelectItem value="citations">Zitationen</SelectItem><SelectItem value="emerging">Emerging Signal</SelectItem></SelectContent></Select>
        <Button asChild variant="outline" size="sm"><a href={exportUrl("csv")}><Download />CSV</a></Button>
        <Button asChild variant="outline" size="sm"><a href={exportUrl("bibtex")}><FileText />BibTeX</a></Button>
      </div>
      <div className="corpus-filter-grid">
        <Select value={filters.layer} onValueChange={(value) => changeFilter("layer", value as CorpusFilters["layer"])}><SelectTrigger aria-label="Suchschicht filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Suchschichten</SelectItem><SelectItem value="core">Core</SelectItem><SelectItem value="broad">Broad</SelectItem><SelectItem value="frontier">Frontier</SelectItem></SelectContent></Select>
        <Select value={filters.venueKind} onValueChange={(value) => changeFilter("venueKind", value as CorpusFilters["venueKind"])}><SelectTrigger aria-label="Quellentyp filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Journal, Konferenz, Repository</SelectItem><SelectItem value="journal">Journals</SelectItem><SelectItem value="conference">Konferenzen</SelectItem><SelectItem value="repository">Repositories</SelectItem></SelectContent></Select>
        <Select value={filters.venue} onValueChange={(value) => changeFilter("venue", value)}><SelectTrigger aria-label="Quelle filtern"><SelectValue placeholder="Alle Quellen" /></SelectTrigger><SelectContent><SelectItem value="all">Alle Quellen</SelectItem>{data?.facets.venues.filter((facet) => filters.venueKind === "all" || facet.kind === filters.venueKind).map((facet) => <SelectItem value={facet.value} key={`${facet.kind}-${facet.value}`}>{facet.label} ({facet.count})</SelectItem>)}</SelectContent></Select>
        <Select value={filters.theme} onValueChange={(value) => changeFilter("theme", value)}><SelectTrigger aria-label="Thema filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Themen</SelectItem>{data?.facets.themes.map((facet) => <SelectItem value={facet.value} key={facet.value}>{facet.label} ({facet.count})</SelectItem>)}</SelectContent></Select>
        <Select value={filters.publicationType} onValueChange={(value) => changeFilter("publicationType", value as CorpusFilters["publicationType"])}><SelectTrigger aria-label="Publikationstyp filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Publikationstypen</SelectItem><SelectItem value="journal">Journalartikel</SelectItem><SelectItem value="proceedings">Proceedings</SelectItem><SelectItem value="preprint">Preprints</SelectItem></SelectContent></Select>
        <Select value={filters.period} onValueChange={(value) => changeFilter("period", value as CorpusFilters["period"])}><SelectTrigger aria-label="Zeitraum filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Gesamter Zeitraum</SelectItem><SelectItem value="1">Laufendes Jahr</SelectItem><SelectItem value="3">Letzte 3 Kalenderjahre</SelectItem><SelectItem value="5">Letzte 5 Kalenderjahre</SelectItem><SelectItem value="10">Letzte 10 Kalenderjahre</SelectItem></SelectContent></Select>
        <Select value={filters.workDomain} onValueChange={(value) => changeFilter("workDomain", value)}><SelectTrigger aria-label="Arbeitsdomäne anhand gespeicherter OpenAlex Topics filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Arbeitsdomänen / Topics</SelectItem>{data?.facets.workDomains.map((facet) => <SelectItem value={facet.value} key={facet.value}>{facet.label} ({facet.count})</SelectItem>)}</SelectContent></Select>
        <Select value={filters.studyType} disabled><SelectTrigger aria-label="Methode oder Studientyp nicht verfügbar"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unavailable">Studientyp nicht strukturiert erfasst</SelectItem></SelectContent></Select>
      </div>
      <div className="corpus-filter-footer"><span>Arbeitsdomänen verwenden unverändert gespeicherte OpenAlex Topics. Methoden-/Studientypfilter bleiben deaktiviert, solange keine strukturierten Metadaten vorliegen.</span><Button type="button" variant="ghost" size="sm" onClick={resetFilters}>Filter zurücksetzen</Button></div>
    </section>

    {mode === "weekly" && data?.weeklyWindow && <div className="workflow-context-note" role="status"><CalendarDays /><span><strong>Reproduzierbare Wochen-Shortlist:</strong> gespeicherte Erstfunde vom {formatDate(data.weeklyWindow.startAt)} bis {formatDate(data.weeklyWindow.endAt)}, verankert am letzten erfolgreichen Lauf.</span></div>}
    {mode === "new" && data?.latestSuccessfulRun && <div className="workflow-context-note" role="status"><Database /><span><strong>Neu seit letztem erfolgreichen Lauf:</strong> {data.latestSuccessfulRun.source} · {data.latestSuccessfulRun.searchLayer} · abgeschlossen {formatDateTime(data.latestSuccessfulRun.endedAt)}.</span></div>}
    {mode === "shortlist" && <div className="workflow-context-note" role="status"><BookMarked /><span><strong>Persönliche Shortlist:</strong> {shortlist.storage === "d1" ? "sicher nutzerbezogen in D1 gespeichert" : shortlist.storage === "browser" ? "anonym – nur auf diesem Gerät im Browser gespeichert" : "Speicherung derzeit nicht verfügbar"}.</span></div>}
    {shortlist.error && <div className="error-banner partial" role="status"><Star /><span>{shortlist.error}</span></div>}
    {error && <div className="error-banner unavailable" role="alert"><Database /><span>{error}</span></div>}

    <section className="panel corpus-results" aria-busy={loading}>
      <div className="result-bar" aria-live="polite"><span>{data ? `${data.pagination.total} Treffer im gespeicherten Korpus` : "Korpus wird abgefragt"}</span><span>Serverseitig sortiert und paginiert</span></div>
      {loading ? <CorpusLoading /> : data?.items.length ? <div className="work-list spacious">{data.items.map((work) => <PublicationCard key={work.id} work={work} shortlist={shortlist} />)}</div> : <EmptyCorpus title={mode === "shortlist" ? "Deine Shortlist ist leer" : "Keine Publikationen gefunden"} message={mode === "shortlist" ? "Markiere Publikationen mit dem Stern, um sie hier zu sammeln." : "Passe Suche oder Filter an. Es werden keine Beispieldaten ergänzt."} />}
      {data && data.pagination.totalPages > 1 && <nav className="corpus-pagination" aria-label="Seitennavigation des Forschungskorpus"><Button type="button" variant="outline" size="sm" disabled={data.pagination.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Vorherige Seite</Button><span>Seite {data.pagination.page} von {data.pagination.totalPages}</span><Button type="button" variant="outline" size="sm" disabled={data.pagination.page >= data.pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Nächste Seite</Button></nav>}
    </section>
  </section>;
}

export function NewPublicationsPreview({ scope, shortlist }: { scope: "ai" | "field"; shortlist: ShortlistControls }) {
  const [data, setData] = useState<RadarCorpusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/works?scope=${scope}&mode=new&page=1&pageSize=10&sort=date`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Neue Publikationen konnten nicht geladen werden.");
        return response.json() as Promise<RadarCorpusResponse>;
      })
      .then((payload) => { setData(payload); setError(null); })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Neue Publikationen sind nicht verfügbar.");
      });
    return () => controller.abort();
  }, [scope]);
  return <section className="panel workflow-new-publications">
    <div className="panel-heading compact-heading"><div><p className="section-kicker">Neu seit letztem Lauf</p><h2>Neue Publikationen</h2><p className="panel-subtitle">Nicht zeitlich geschätzt, sondern über den letzten erfolgreichen Ingestion Run bestimmt.</p></div><Badge variant="outline">{data?.pagination.total ?? "–"} neu</Badge></div>
    {error ? <div className="compact-empty" role="alert">{error}</div> : !data ? <div className="overview-loading"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div> : data.items.length ? <div className="work-list compact-workflow-list">{data.items.slice(0, 2).map((work) => <PublicationCard compact key={work.id} work={work} shortlist={shortlist} />)}</div> : <EmptyCorpus title="Keine neuen Publikationen" message="Der letzte erfolgreiche Lauf hat keine neuen, deduplizierten Werke angelegt." />}
  </section>;
}
