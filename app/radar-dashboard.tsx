"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight, BookOpen, BrainCircuit, Building2, CalendarClock, CalendarDays, Database, FileClock,
  Download, Layers3, Megaphone, RefreshCw, Search, ShieldCheck, Target, TrendingUp,
} from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CorpusBrowser, NewPublicationsPreview } from "@/app/corpus-browser";
import type { CallStatus, DataStatus, RadarCall, RadarData, RadarThemeTrendSignal } from "@/app/radar-types";
import { useShortlist } from "@/app/use-shortlist";
import { isCallVisibleByDefault } from "@/lib/calls/status";

const THEME_META: Record<string, { label: string; className: string }> = {
  learning: { label: "Lernen", className: "theme-learning" }, trust: { label: "Vertrauen", className: "theme-trust" },
  agency: { label: "Agency", className: "theme-agency" }, cognition: { label: "Kognition", className: "theme-cognition" },
  teaming: { label: "Teaming", className: "theme-teaming" }, motivation: { label: "Motivation", className: "theme-motivation" },
  safety: { label: "Sicherheit", className: "theme-safety" }, participation: { label: "Partizipation", className: "theme-participation" },
  "cross-cutting": { label: "Querschnitt", className: "theme-cross-cutting" },
};

const CALL_TYPE_LABELS: Record<RadarCall["callType"], string> = {
  papers: "Call for Papers",
  special_issue: "Special Issue",
  conference: "Konferenz",
  workshop: "Workshop",
};

const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  open: "Offen",
  closing: "Schliesst bald",
  expired: "Abgelaufen",
  unverified: "Prüfung nötig",
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("de-CH", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
function fullNumber(value: number) { return new Intl.NumberFormat("de-CH").format(value); }
function formatDate(value: string) {
  if (!value) return "Datum offen";
  return new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function formatCacheDuration(seconds: number) {
  return seconds % 3_600 === 0 ? `${seconds / 3_600} Stunden` : `${Math.round(seconds / 60)} Minuten`;
}
function signedPercent(value: number | null) { return value === null ? "Nicht belastbar" : `${value >= 0 ? "+" : ""}${value} %`; }
function percentage(value: number | null) { return value === null ? "–" : `${value} %`; }
const SIGNAL_STATUS_LABELS: Record<string, string> = {
  growing: "wachsend", declining: "rückläufig", stable: "stabil", mixed: "gemischt", insufficient: "nicht belastbar",
  burst: "Burst erkannt", rising: "Frühsignal", cooling: "abkühlend",
  strong: "stark", moderate: "moderat", weak: "schwach", unavailable: "nicht verfügbar",
};
function signalStatusLabel(status: string) { return SIGNAL_STATUS_LABELS[status] ?? status; }
function dateFromNow(days: number) { const value = new Date(); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }

function StatusBadge({ status }: { status: RadarData["status"] }) {
  const label = status === "live" ? "Daten verfügbar" : status === "partial" ? "Teilweise verfügbar" : "Daten nicht verfügbar";
  return <Badge variant="outline" className={`live-badge ${status}`}><span className="live-dot" />{label}</Badge>;
}

function DatasetStatusBadge({ label, status }: { label: string; status: DataStatus }) {
  const statusLabel = status === "live" ? "live" : status === "partial" ? "teilweise" : "nicht verfügbar";
  return <span className={`dataset-status ${status}`}><span className="live-dot" />{label}: {statusLabel}</span>;
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="empty-state"><Search /><h3>{title}</h3><p>{message}</p></div>;
}

function MetricCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="metric-card"><div className="metric-icon">{icon}</div><p className="metric-label">{label}</p><p className="metric-value">{value}</p><p className="metric-note">{note}</p></article>;
}

function CallCard({ call, compact = false }: { call: RadarCall; compact?: boolean }) {
  return <article className={`call-card ${compact ? "compact" : ""}`}>
    <div className="call-card-top"><Badge variant="outline">{CALL_TYPE_LABELS[call.callType]}</Badge><span className={`call-status ${call.status}`}>{CALL_STATUS_LABELS[call.status]}</span></div>
    <h3><a href={call.officialUrl} target="_blank" rel="noreferrer">{call.title}<ArrowUpRight aria-hidden="true" /></a></h3>
    <p className="call-organizer"><Building2 aria-hidden="true" />{call.organizer}</p>
    {!compact && <p className="call-description">{call.description}</p>}
    <dl className="call-dates">
      <div><dt>Einreichungsdeadline</dt><dd>{call.submissionDeadline ? formatDate(call.submissionDeadline) : "Nicht ausgewiesen"}</dd></div>
      {!compact && <div><dt>Publikation / Veranstaltung</dt><dd>{call.eventOrPublicationDate ? formatDate(call.eventOrPublicationDate) : "Nicht ausgewiesen"}</dd></div>}
    </dl>
    {!compact && <div className="theme-row">{call.themes.map((theme) => <span key={theme} className={`theme-chip ${THEME_META[theme]?.className ?? ""}`}>{THEME_META[theme]?.label ?? theme}</span>)}</div>}
    <div className="call-verification"><ShieldCheck aria-hidden="true" /><span>{call.verifiedAt ? `Verifiziert ${formatDateTime(call.verifiedAt)}` : "Noch nicht verifiziert"} · zuletzt geprüft {formatDateTime(call.lastCheckedAt)}</span><a href={call.officialUrl} target="_blank" rel="noreferrer">Offizielle Quelle</a></div>
  </article>;
}

function TrendThemeCard({ signal }: { signal: RadarThemeTrendSignal }) {
  const qualityLabel = signal.dataQuality.status === "sufficient" ? "ausreichend" : signal.dataQuality.status === "limited" ? "begrenzt" : signal.dataQuality.status === "insufficient" ? "zu gering" : "nicht verfügbar";
  return <article className="panel theme-signal-card">
    <div className="theme-signal-heading">
      <div><p className="section-kicker">{signal.windows.shortRecent.startYear}–{signal.windows.shortRecent.endYear} · abgeschlossen</p><h3>{signal.label}</h3></div>
      <span className={`quality-state ${signal.dataQuality.status}`}>Datenqualität: {qualityLabel}</span>
    </div>
    <div className="signal-separation-grid emerging-signal-grid">
      <div><span>Beobachteter Publikationstrend</span><strong>{signalStatusLabel(signal.observedTrend.status)}</strong><p>{signal.observedTrend.interpretation}</p></div>
      <div><span>Emerging Signal</span><strong>{signalStatusLabel(signal.emergingSignal.status)}</strong><p>{signal.emergingSignal.interpretation}</p></div>
      <div><span>Agenda-Signal aus Calls</span><strong>{signalStatusLabel(signal.agendaSignal.status)} · {signal.agendaSignal.activeCalls} aktiv</strong><p>{signal.agendaSignal.interpretation}</p></div>
    </div>
    <dl className="trend-metric-grid">
      <div><dt>Publikationen absolut</dt><dd>{signal.windows.shortRecent.absoluteCount}</dd><small>{signal.windows.shortRecent.yearCount} gleich lange Jahre</small></div>
      <div><dt>Pro 1’000 im Vergleichsfeld</dt><dd>{signal.windows.shortRecent.perThousand ?? "–"}</dd><small>{signal.windows.shortRecent.comparisonFieldCount ?? "Nenner fehlt"} Vergleichsdatensätze</small></div>
      <div><dt>Journal / Preprint</dt><dd>{percentage(signal.windows.shortRecent.journalShare)} / {percentage(signal.windows.shortRecent.preprintShare)}</dd><small>{signal.windows.shortRecent.journalCount} Journal · {signal.windows.shortRecent.preprintCount} Preprint</small></div>
      <div><dt>Kurzfristiges Wachstum</dt><dd>{signedPercent(signal.shortGrowthPercent)}</dd><small>{signal.windows.shortPrevious.startYear}–{signal.windows.shortPrevious.endYear} vs. {signal.windows.shortRecent.startYear}–{signal.windows.shortRecent.endYear}</small></div>
      <div><dt>Langfristiges Wachstum</dt><dd>{signedPercent(signal.longGrowthPercent)}</dd><small>Zwei abgeschlossene {signal.windows.longRecent.yearCount}-Jahresfenster</small></div>
      <div><dt>Beschleunigung</dt><dd>{signal.accelerationPercentagePoints === null ? "–" : `${signal.accelerationPercentagePoints >= 0 ? "+" : ""}${signal.accelerationPercentagePoints} Pp.`}</dd><small>{signal.acceleration}</small></div>
      <div><dt>Quellen- / Venue-Diversität</dt><dd>{signal.diversity.sourceCount} / {signal.diversity.venueCount}</dd><small>Diversitätsindex {signal.diversity.venueDiversityPercent ?? "–"}%</small></div>
      <div><dt>Laufendes Jahr separat</dt><dd>{signal.currentYear.count}</dd><small>{signal.currentYear.year} partiell · nicht verglichen</small></div>
    </dl>
    <div className="change-point-note"><TrendingUp aria-hidden="true" /><span><strong>Change-Point-Test:</strong> {signal.changePoint.direction === "insufficient" ? "Mindestfallzahl nicht erreicht" : signal.changePoint.detected ? `${signal.changePoint.direction === "up" ? "Aufwärts-" : "Abwärts-"}Wechsel erkannt (z=${signal.changePoint.zScore})` : `kein Wechsel oberhalb der Schwelle (z=${signal.changePoint.zScore})`}. {signal.changePoint.method}</span></div>
    {(signal.contradictions.length > 0 || signal.dataQuality.issues.length > 0) && <div className="signal-uncertainty">
      {signal.contradictions.map((issue) => <p key={issue}><strong>Widersprüchliches Signal:</strong> {issue}</p>)}
      {signal.dataQuality.issues.map((issue) => <p key={issue}><strong>Unsicherheit:</strong> {issue}</p>)}
    </div>}
  </article>;
}

function OpportunityCard({ signal }: { signal: RadarThemeTrendSignal }) {
  const score = signal.opportunity.score === null ? "Nicht belastbar" : `${signal.opportunity.score}/100`;
  return <article className="panel opportunity-card">
    <div className="opportunity-card-heading"><div><p className="section-kicker">Mögliche Research Opportunity · {signal.label}</p><h3>{score}</h3><p>{signal.opportunity.interpretation}</p></div><span className={`quality-state ${signal.dataQuality.status}`}>Datenqualität: {signal.dataQuality.status}</span></div>
    <div className="opportunity-signal-context">
      <div><span>Beobachteter Trend</span><strong>{signalStatusLabel(signal.observedTrend.status)}</strong></div>
      <div><span>Emerging Signal</span><strong>{signalStatusLabel(signal.emergingSignal.status)}</strong></div>
      <div><span>Agenda-Signal</span><strong>{signalStatusLabel(signal.agendaSignal.status)} · {signal.agendaSignal.activeCalls} Calls</strong></div>
      <div><span>Journalanteil</span><strong>{percentage(signal.windows.shortRecent.journalShare)}</strong></div>
    </div>
    <div className="opportunity-components">
      <p>Einzeln sichtbare Komponenten · kein KI-Score</p>
      {signal.opportunity.components.map((component) => <div key={component.key}><span>{component.label}</span><div><i style={{ width: `${(component.score / component.maximum) * 100}%` }} /></div><strong>{component.score}/{component.maximum}</strong><small>{component.rationale}</small></div>)}
    </div>
    {(signal.contradictions.length > 0 || signal.dataQuality.issues.length > 0) && <div className="signal-uncertainty">
      {signal.contradictions.map((issue) => <p key={issue}><strong>Widersprüchliches Signal:</strong> {issue}</p>)}
      {signal.dataQuality.issues.map((issue) => <p key={issue}><strong>Unsicherheit:</strong> {issue}</p>)}
    </div>}
  </article>;
}

function ResearchChart({ data, large = false }: { data: RadarData; large?: boolean }) {
  const ytdYear = data.trend[data.trend.length - 1]?.year ?? new Date().getUTCFullYear();
  return (
    <div className={large ? "chart-wrap large" : "chart-wrap"}>
      <div className="chart-legend" aria-label="Legende">
        <span><i className="legend-article" />Journalartikel</span><span><i className="legend-preprint" />Preprints</span>
        <span className="chart-note">{ytdYear}: laufendes Jahr</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.trend} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
          <defs><linearGradient id="articleFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1f6a5e" stopOpacity={0.34} /><stop offset="100%" stopColor="#1f6a5e" stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid stroke="#d8d8cf" strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "#68706b", fontSize: 11 }} />
          <YAxis width={50} tickLine={false} axisLine={false} tickFormatter={compactNumber} tick={{ fill: "#68706b", fontSize: 11 }} />
          <Tooltip cursor={{ stroke: "#79827d", strokeDasharray: "3 4" }} contentStyle={{ borderRadius: 12, border: "1px solid #d4d5cc", boxShadow: "0 12px 32px rgba(31, 42, 37, .1)" }} formatter={(value, name) => [value === null || value === undefined ? "Nicht verfügbar" : fullNumber(Number(value)), name === "article" ? "Journalartikel" : "Preprints"]} labelFormatter={(year) => `${year}${Number(year) === ytdYear ? " (laufend)" : ""}`} />
          <Area type="monotone" dataKey="article" stroke="#1f6a5e" strokeWidth={2.5} fill="url(#articleFill)" />
          <Line type="monotone" dataKey="preprint" stroke="#e1644b" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function LoadingState() {
  return <div className="loading-grid" aria-label="Daten werden geladen"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-80 rounded-2xl md:col-span-2" /><Skeleton className="h-80 rounded-2xl" /></div>;
}

export default function RadarDashboard() {
  const [scope, setScope] = useState<"ai" | "field">("ai");
  const [callType, setCallType] = useState("all");
  const [callDeadline, setCallDeadline] = useState("active");
  const [callSource, setCallSource] = useState("all");
  const [callTheme, setCallTheme] = useState("all");
  const [data, setData] = useState<RadarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const shortlist = useShortlist();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(`/api/radar?days=365&scope=${scope}&refresh=${refreshKey}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Die Forschungsdaten konnten nicht geladen werden."); return response.json() as Promise<RadarData>; })
      .then((payload) => { if (active) { setData(payload); setError(null); } })
      .catch((reason) => { if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return; setError(reason instanceof Error ? reason.message : "Unbekannter Ladefehler"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [scope, refreshKey]);

  const changeScope = (value: string) => { setLoading(true); setError(null); setData(null); setScope(value as "ai" | "field"); };
  const refresh = () => { setLoading(true); setError(null); setRefreshKey((value) => value + 1); };

  const filteredCalls = useMemo(() => {
    if (!data) return [];
    const today = new Date().toISOString().slice(0, 10);
    const in30Days = dateFromNow(30);
    const in90Days = dateFromNow(90);
    return data.calls.calls.filter((call) => {
      if (callType !== "all" && call.callType !== callType) return false;
      if (callSource !== "all" && call.sourceKey !== callSource) return false;
      if (callTheme !== "all" && !call.themes.includes(callTheme)) return false;
      if (callDeadline === "active") return isCallVisibleByDefault(call, today);
      if (callDeadline === "expired") return call.status === "expired";
      if (callDeadline === "30") return Boolean(call.submissionDeadline && call.submissionDeadline >= today && call.submissionDeadline <= in30Days);
      if (callDeadline === "90") return Boolean(call.submissionDeadline && call.submissionDeadline >= today && call.submissionDeadline <= in90Days);
      if (callDeadline === "later") return Boolean(call.submissionDeadline && call.submissionDeadline > in90Days);
      return true;
    });
  }, [callDeadline, callSource, callTheme, callType, data]);

  const nextDeadlines = useMemo(() => data?.calls.calls
    .filter((call) => call.status === "open" || call.status === "closing")
    .filter((call) => Boolean(call.submissionDeadline))
    .slice(0, 3) ?? [], [data]);
  const availableCallThemes = useMemo(() => data ? [...new Set(data.calls.calls.flatMap((call) => call.themes))].sort() : [], [data]);
  const supportedOverviewQuestions = useMemo(() => data?.questions.dataDerived
    .filter((question) => question.status === "supported")
    .slice(0, 4) ?? [], [data]);
  const leadingOpportunity = useMemo(() => data?.trendAnalysis.themes
    .filter((signal) => signal.opportunity.status === "possible" && signal.opportunity.score !== null)
    .sort((left, right) => Number(right.opportunity.score) - Number(left.opportunity.score))[0] ?? null, [data]);
  const importantEmergingSignals = useMemo(() => data?.trendAnalysis.themes
    .filter((signal) => signal.emergingSignal.status === "burst" || signal.emergingSignal.status === "rising")
    .sort((left, right) => {
      const rank = (status: RadarThemeTrendSignal["emergingSignal"]["status"]) => status === "burst" ? 2 : status === "rising" ? 1 : 0;
      return rank(right.emergingSignal.status) - rank(left.emergingSignal.status) || Number(right.shortGrowthPercent ?? -Infinity) - Number(left.shortGrowthPercent ?? -Infinity);
    }).slice(0, 3) ?? [], [data]);
  const opportunitySignals = useMemo(() => data?.trendAnalysis.themes.slice().sort((left, right) =>
    Number(right.opportunity.score ?? -1) - Number(left.opportunity.score ?? -1) || left.label.localeCompare(right.label)
  ) ?? [], [data]);

  const availabilityIssues = data ? Object.values(data.dataStatus).filter((dataset) => dataset.error).map((dataset) => dataset.error) : [];
  const foundCountAvailable = Boolean(data && (data.counts.journal !== null || data.counts.preprint !== null));
  const sourceCountNote = data
    ? `${data.counts.journal === null ? "Journal nicht verfügbar" : `${fullNumber(data.counts.journal)} Journal`} · ${data.counts.preprint === null ? "Preprints nicht verfügbar" : `${fullNumber(data.counts.preprint)} Preprint`}`
    : "";
  const trendYtdYear = data?.trend[data.trend.length - 1]?.year ?? new Date().getUTCFullYear();

  return (
    <main className="radar-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="radar-mark" aria-hidden="true"><span /></div><div><p className="eyebrow">Research intelligence workspace</p><h1>Human–AI Research Radar</h1></div></div>
        <div className="topbar-actions">{data && <StatusBadge status={data.status} />}<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />Aktualisieren</Button></div>
      </header>

      <Tabs defaultValue="overview" className="dashboard-tabs">
        <div className="control-deck">
          <TabsList variant="line" className="main-tabs" aria-label="Dashboard-Bereiche">
            <TabsTrigger value="overview">Überblick</TabsTrigger><TabsTrigger value="publications">Neue Publikationen</TabsTrigger><TabsTrigger value="themes">Themenlandschaft</TabsTrigger><TabsTrigger value="emerging">Emerging Signals</TabsTrigger><TabsTrigger value="calls">Calls</TabsTrigger><TabsTrigger value="opportunities">Opportunities</TabsTrigger><TabsTrigger value="method">Methodik</TabsTrigger>
          </TabsList>
          <div className="filters workspace-scope-filter" aria-label="Globaler Forschungsfokus">
            <Select value={scope} onValueChange={changeScope}><SelectTrigger size="sm" aria-label="Forschungsfokus"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ai">KI × Mensch & Arbeit</SelectItem><SelectItem value="field">Gesamtes HFE-Feld</SelectItem></SelectContent></Select>
          </div>
        </div>

        {error && <div className="error-banner" role="alert"><ShieldCheck /><span>{error}</span><Button variant="outline" size="sm" onClick={refresh}>Erneut versuchen</Button></div>}

        {data && <section className="data-integrity-bar" aria-label="Datenstatus und Aktualität">
          <div className="dataset-statuses">
            <DatasetStatusBadge label="Publikationen" status={data.dataStatus.publications.status} />
            <DatasetStatusBadge label="Preprints" status={data.dataStatus.preprints.status} />
            <DatasetStatusBadge label="Trends" status={data.dataStatus.trends.status} />
            <DatasetStatusBadge label="Calls" status={data.dataStatus.calls.status} />
          </div>
          <dl className="query-facts">
            <div><dt>Dashboard-Abfrage</dt><dd>{formatDateTime(data.dashboardQueriedAt)}</dd></div>
            <div><dt>Neuestes Publikationsdatum</dt><dd>{data.newestPublicationDate ? formatDate(data.newestPublicationDate) : "Nicht verfügbar"}</dd></div>
            <div><dt>Insgesamt gefunden</dt><dd>{foundCountAvailable ? `${data.counts.totalFoundComplete ? "" : "mind. "}${fullNumber(data.counts.totalFound)}` : "Nicht verfügbar"}</dd></div>
            <div><dt>Tatsächlich analysiert</dt><dd>{fullNumber(data.counts.analyzed)}</dd></div>
            <div><dt>Cache-Dauer</dt><dd>{formatCacheDuration(data.cacheDurationSeconds)}</dd></div>
            <div><dt>Gespeicherter Datenstand</dt><dd>{data.storage.dataSnapshotAt ? formatDateTime(data.storage.dataSnapshotAt) : "Noch nicht initialisiert"}</dd></div>
          </dl>
        </section>}

        {data?.storage.state === "empty" && <div className="error-banner initialization-banner" role="status"><Database /><span><strong>Datenbank bereit, Initialisierung ausstehend.</strong> Starte den geschützten Ingestion-Befehl, damit der erste persistente Datenbestand aufgebaut wird.</span></div>}

        {data && data.storage.state !== "empty" && availabilityIssues.length > 0 && <div className={`error-banner availability-banner ${data.status}`} role={data.status === "unavailable" ? "alert" : "status"}><ShieldCheck /><span>{availabilityIssues.join(" ")}</span></div>}

        {loading && !data ? <LoadingState /> : data ? <>
          <TabsContent value="overview" className="tab-space">
            <section className="workflow-overview-grid" aria-label="Aktueller Forschungsworkflow">
              <NewPublicationsPreview scope={scope} shortlist={shortlist} />
              <section className="panel workflow-deadlines">
                <div className="panel-heading compact-heading"><div><p className="section-kicker">Nächste Call-Deadlines</p><h2>Agenda im Blick</h2><p className="panel-subtitle">Verifizierte Calls, getrennt von Publikationsevidenz.</p></div><CalendarClock /></div>
                {nextDeadlines.length ? <div className="overview-deadline-list">{nextDeadlines.map((call) => <a href={call.officialUrl} target="_blank" rel="noreferrer" key={call.id}><span>{call.submissionDeadline ? formatDate(call.submissionDeadline) : "Offen"}</span><strong>{call.title}</strong><small>{call.organizer}</small></a>)}</div> : <EmptyState title="Keine verifizierten Deadlines" message="Nach einer erfolgreichen Calls-Ingestion erscheinen hier die nächsten Termine." />}
              </section>
              <section className="panel workflow-emerging">
                <div className="panel-heading compact-heading"><div><p className="section-kicker">Wichtigste Emerging Signals</p><h2>Explorative Frühsignale</h2><p className="panel-subtitle">Nur aktuell berechnete Block‑6-Signale.</p></div><TrendingUp /></div>
                {importantEmergingSignals.length ? <div className="overview-signal-list">{importantEmergingSignals.map((signal) => <div key={signal.theme}><span>{signalStatusLabel(signal.emergingSignal.status)}</span><strong>{signal.label}</strong><small>{signedPercent(signal.shortGrowthPercent)} kurzfristig · {percentage(signal.windows.shortRecent.preprintShare)} Preprints</small></div>)}</div> : <EmptyState title="Kein belastbares Emerging Signal" message="Mindestfallzahl oder Datenqualität reichen aktuell für kein hervorgehobenes Frühsignal." />}
              </section>
              <section className="panel workflow-freshness">
                <div className="panel-heading compact-heading"><div><p className="section-kicker">Quellenstatus und Aktualität</p><h2>Was tatsächlich vorliegt</h2></div><ShieldCheck /></div>
                <div className="workflow-source-status"><DatasetStatusBadge label="Publikationen" status={data.dataStatus.publications.status} /><DatasetStatusBadge label="Preprints" status={data.dataStatus.preprints.status} /><DatasetStatusBadge label="Trends" status={data.dataStatus.trends.status} /><DatasetStatusBadge label="Calls" status={data.dataStatus.calls.status} /></div>
                <dl className="workflow-freshness-facts"><div><dt>Daten-Snapshot</dt><dd>{data.storage.dataSnapshotAt ? formatDateTime(data.storage.dataSnapshotAt) : "Noch nicht vorhanden"}</dd></div><div><dt>Dashboard-Abfrage</dt><dd>{formatDateTime(data.dashboardQueriedAt)}</dd></div><div><dt>Neuestes Publikationsdatum</dt><dd>{data.newestPublicationDate ? formatDate(data.newestPublicationDate) : "Nicht vorhanden"}</dd></div><div><dt>Analysiert</dt><dd>{fullNumber(data.counts.analyzed)} Datensätze</dd></div></dl>
              </section>
            </section>
            <section className="metric-grid" aria-label="Kennzahlen">
              <MetricCard icon={<BookOpen />} label="Gefunden · letzte 12 Monate" value={foundCountAvailable ? `${data.counts.totalFoundComplete ? "" : "≥ "}${compactNumber(data.counts.totalFound)}` : "—"} note={sourceCountNote} />
              <MetricCard icon={<BrainCircuit />} label="Tatsächlich analysiert" value={fullNumber(data.counts.analyzed)} note="Nach Normalisierung und Deduplikation" />
              <MetricCard icon={<CalendarDays />} label="Neuestes Publikationsdatum" value={data.newestPublicationDate ? formatDate(data.newestPublicationDate) : "—"} note="Neuestes Datum im analysierten Datensatz" />
              <MetricCard icon={<FileClock />} label="Cache-Dauer" value={formatCacheDuration(data.cacheDurationSeconds)} note={`Danach max. ${formatCacheDuration(data.staleWhileRevalidateSeconds)} während Revalidierung`} />
            </section>
            <section className="workflow-secondary-grid">
              <section className="panel question-mini-panel"><div className="panel-heading compact-heading"><div><p className="section-kicker">Themenlandschaft</p><h2>Belegte Forschungsfragen</h2></div><Layers3 /></div><div className="question-mini-list">{supportedOverviewQuestions.map((item, index) => <div key={item.id} className="question-mini"><span>{index + 1}</span><div><p>{item.label}</p><small>{item.question}</small></div><strong>{item.count}</strong></div>)}{supportedOverviewQuestions.length === 0 && <p className="compact-empty">Noch kein datenabgeleitetes Fragemuster mit mindestens {data.questions.minimumEvidenceRecords} Evidenzdatensätzen.</p>}</div></section>
              <section className="panel opportunity-overview"><div className="panel-heading compact-heading"><div><p className="section-kicker">Opportunities</p><h2>Transparentestes aktuelles Muster</h2></div><Target /></div>{leadingOpportunity ? <div className="opportunity-overview-body"><strong>{leadingOpportunity.opportunity.score}/100</strong><h3>{leadingOpportunity.label}</h3><p>{leadingOpportunity.opportunity.interpretation}</p></div> : <EmptyState title="Keine belastbare Opportunity" message="Bei unzureichender Datenqualität wird kein Gesamtscore gezeigt." />}</section>
            </section>
          </TabsContent>

          <TabsContent value="publications" className="tab-space">
            <div className="workflow-section-intro"><p className="section-kicker">Gespeicherter Forschungskorpus</p><h2>Neue Publikationen, Wochenansicht und persönliche Shortlist</h2><p>Suche und Filter laufen serverseitig über den vollständigen gespeicherten Korpus. „Neu“ bezieht sich auf den letzten erfolgreichen Ingestion Run, nicht auf ein pauschales Sieben-Tage-Fenster.</p></div>
            <CorpusBrowser key={scope} scope={scope} shortlist={shortlist} />
          </TabsContent>

          <TabsContent value="calls" className="tab-space">
            <section className="calls-intro">
              <div><p className="section-kicker">Calls · eigenständiges Agenda-Signal</p><h2>Calls for Papers, Special Issues, Konferenzen und Workshops</h2></div>
              <p>{data.calls.interpretation} In der Opportunity-Analyse bleibt dieses Agenda-Signal als eigene, sichtbare Komponente von Publikationstrends getrennt.</p>
            </section>
            <section className="panel calls-toolbar" aria-label="Calls filtern">
              <Select value={callType} onValueChange={setCallType}><SelectTrigger size="sm" aria-label="Call-Typ"><Megaphone /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Call-Typen</SelectItem><SelectItem value="papers">Call for Papers</SelectItem><SelectItem value="special_issue">Special Issues</SelectItem><SelectItem value="conference">Konferenzen</SelectItem><SelectItem value="workshop">Workshops</SelectItem></SelectContent></Select>
              <Select value={callDeadline} onValueChange={setCallDeadline}><SelectTrigger size="sm" aria-label="Deadline"><CalendarClock /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Aktiv · ohne abgelaufene</SelectItem><SelectItem value="30">Nächste 30 Tage</SelectItem><SelectItem value="90">Nächste 90 Tage</SelectItem><SelectItem value="later">Später</SelectItem><SelectItem value="expired">Historie · abgelaufen</SelectItem><SelectItem value="all">Alle inklusive Historie</SelectItem></SelectContent></Select>
              <Select value={callSource} onValueChange={setCallSource}><SelectTrigger size="sm" aria-label="Calls-Quelle"><Building2 /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle offiziellen Quellen</SelectItem>{data.calls.sources.map((source) => <SelectItem key={source.key} value={source.key}>{source.name}</SelectItem>)}</SelectContent></Select>
              <Select value={callTheme} onValueChange={setCallTheme}><SelectTrigger size="sm" aria-label="Calls-Themencluster"><BrainCircuit /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Themencluster</SelectItem>{availableCallThemes.map((item) => <SelectItem key={item} value={item}>{THEME_META[item]?.label ?? item}</SelectItem>)}</SelectContent></Select>
            </section>
            {data.calls.status.status !== "live" && <div className={`error-banner calls-source-warning ${data.calls.status.status}`} role="status"><ShieldCheck /><span>{data.calls.status.error}</span></div>}
            <section className="calls-layout">
              <div className="panel calls-results">
                <div className="result-bar"><span>{filteredCalls.length} Calls</span><span>Nach Einreichungsdeadline sortiert</span></div>
                <div className="call-list">{filteredCalls.map((call) => <CallCard key={call.id} call={call} />)}{filteredCalls.length === 0 && <EmptyState title="Keine Calls für diese Auswahl" message="Es werden keine statischen Beispiele ergänzt. Prüfe Filter oder starte die geschützte Calls-Ingestion." />}</div>
              </div>
              <aside className="calls-side-stack">
                <section className="panel agenda-panel"><div className="panel-heading compact-heading"><div><p className="section-kicker">Separates Calls-Signal</p><h2>Agenda nach Themencluster</h2></div></div><div className="agenda-list">{data.calls.agendaSignals.map((signal) => <div key={signal.theme}><span>{THEME_META[signal.theme]?.label ?? signal.theme}</span><strong>{signal.count}</strong><small>{signal.closingCount > 0 ? `${signal.closingCount} schliessen bald` : signal.nearestDeadline ? `Nächste Deadline ${formatDate(signal.nearestDeadline)}` : "Keine Deadline"}</small></div>)}{data.calls.agendaSignals.length === 0 && <p className="compact-empty">Keine verifizierten Agenda-Signale verfügbar.</p>}</div></section>
                <section className="panel call-source-panel"><div className="panel-heading compact-heading"><div><p className="section-kicker">Quellenprüfung</p><h2>Offizielle Registry</h2></div></div><div className="call-source-list">{data.calls.sources.map((source) => <div key={source.key}><span className={`source-state ${source.status}`}>{source.status === "verified" ? "Verifiziert" : source.status === "changed" ? "Seite verändert" : source.status === "parser_error" ? "Parserprüfung nötig" : "Nicht verfügbar"}</span><a href={source.officialUrl} target="_blank" rel="noreferrer">{source.name}<ArrowUpRight /></a><small>{source.verifiedAt ? `Geprüft ${formatDateTime(source.verifiedAt)}` : source.error ?? "Nicht verifiziert"}</small></div>)}</div><p className="method-note">Registry {data.calls.registryVersion}. Änderungen oder Parserfehler werden nicht stillschweigend übernommen.</p></section>
              </aside>
            </section>
          </TabsContent>

          <TabsContent value="themes" className="tab-space">
            <section className="questions-intro"><div><p className="section-kicker">Zwei bewusst getrennte Fragetypen</p><h2>Theoretische Linsen und datenabgeleitete Fragen</h2></div><p>Lens Questions sind bewusst vorgegeben. Datenabgeleitete Fragen entstehen ausschliesslich aus belegbaren Mustern im aktuellen Datenausschnitt und ersetzen kein systematisches Review.</p></section>
            <section className="question-section">
              <div className="panel-heading"><div><p className="section-kicker">Vorgegeben · nicht aus Häufigkeiten abgeleitet</p><h2>Theoretische Lens Questions</h2><p className="panel-subtitle">Die Ontologie legt diese Perspektiven vor der Analyse fest. Trefferzahlen entscheiden nicht darüber, ob eine theoretische Linse wichtig ist.</p></div><Badge variant="outline">{data.questions.lens.length} Linsen</Badge></div>
              <div className="question-grid lens-grid">{data.questions.lens.map((item, index) => <article key={item.id} className="question-card lens-question-card">
                <div className="question-card-top"><span className="question-index">L{String(index + 1).padStart(2, "0")}</span><Badge className={THEME_META[item.theme]?.className}>{item.label}</Badge><span className="question-kind">theoretisch</span></div>
                <h3>{item.question}</h3><p className="question-rationale">{item.rationale}</p>
              </article>)}</div>
            </section>
            <section className="question-section derived-section">
              <div className="panel-heading"><div><p className="section-kicker">Deterministisch · evidenzgebunden</p><h2>Datenabgeleitete Research Questions</h2><p className="panel-subtitle">Eine gestützte Frage benötigt mindestens {data.questions.minimumEvidenceRecords} konkrete Publikationen. Ko-Okkurrenz ist noch kein Kausalnachweis.</p></div><Badge variant="outline">Analyse {data.questions.analysisVersion}</Badge></div>
              <div className="question-grid derived-grid">{data.questions.dataDerived.map((item, index) => <article key={item.id} className={`question-card derived-question-card ${item.status}`}>
                <div className="question-card-top"><span className="question-index">D{String(index + 1).padStart(2, "0")}</span><Badge variant="outline">{item.label}</Badge><span className={`question-evidence-status ${item.status}`}>{item.status === "supported" ? `${item.count} Evidenzdatensätze` : "Zu wenig Evidenz"}</span></div>
                <h3>{item.question}</h3><p className="question-rationale">{item.explanation}</p>
                <div className="evidence-box"><span>Konkrete Evidenz</span>{item.evidence.length > 0 ? <ul>{item.evidence.map((evidence) => <li key={evidence.workId}><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.title}<ArrowUpRight /></a></li>)}</ul> : <p>Keine belastbare Evidenzverbindung im aktuellen Datenausschnitt.</p>}</div>
              </article>)}</div>
            </section>
            <section className="panel theme-distribution-panel">
              <div className="panel-heading"><div><p className="section-kicker">Transparenter Kontext · kein Ranking</p><h2>Rohe Themenhäufigkeiten</h2><p className="panel-subtitle">{data.themeAnalysis.comparisonCaveat}</p></div></div>
              <div className="theme-distribution-list">{data.themeAnalysis.distribution.map((item) => <div key={item.theme}><span>{item.label}</span><strong>{item.count}</strong><small>{item.share} % des Samples · {item.configuredVocabularySize} konfigurierte Varianten</small></div>)}</div>
            </section>
          </TabsContent>

          <TabsContent value="emerging" className="tab-space">
            <div className="workflow-section-intro"><p className="section-kicker">Beobachtung und Frühsignal bewusst getrennt</p><h2>Emerging Signals</h2><p>Diese Ansicht zeigt beobachtete Publikationsbewegungen und explorative Frühsignale. Sie macht keine Aussage über künftige Entwicklungen.</p></div>
            <section className="panel trend-main-panel"><div className="panel-heading trend-heading"><div><p className="section-kicker">Vergleichsfeld · laufendes Jahr separat</p><h2>{data.trendAnalysis.comparisonField}</h2><p className="panel-subtitle">Die rohe OpenAlex-Zeitreihe liefert den Nenner für thematische Werte pro 1’000. Vergleiche enden {data.trendAnalysis.latestStableYear}; {data.trendAnalysis.currentYear} ist partiell und ausgeschlossen.</p></div><Badge variant="outline">Snapshot {data.trendAnalysis.snapshotAt ? formatDateTime(data.trendAnalysis.snapshotAt) : "fehlt"}</Badge></div>{data.trend.length > 0 ? <ResearchChart data={data} large /> : <EmptyState title="Vergleichsfeld nicht verfügbar" message="Es liegt noch kein scope-spezifischer Trend-Snapshot vor. Es werden keine Ersatzwerte berechnet." />}</section>
            <section className="trend-method-strip" aria-label="Trendmethode"><div><strong>{data.trendAnalysis.method.shortWindowYears} Jahre</strong><span>kurzfristig, gleich lang</span></div><div><strong>{data.trendAnalysis.method.longWindowYears} Jahre</strong><span>langfristig, gleich lang</span></div><div><strong>{data.trendAnalysis.minimumPublications}</strong><span>Mindestfallzahl je Fenster</span></div><div><strong>{data.trendAnalysis.indexingLagDays} Tage</strong><span>Indexierungsreserve</span></div></section>
            {data.trendAnalysis.status.error && <div className={`error-banner trend-analysis-warning ${data.trendAnalysis.status.status}`} role="status"><ShieldCheck /><span>{data.trendAnalysis.status.error}</span></div>}
            {data.trendAnalysis.themes.length > 0 ? <section className="theme-signal-list">{data.trendAnalysis.themes.map((signal) => <TrendThemeCard key={signal.theme} signal={signal} />)}</section> : <section className="panel"><EmptyState title="Keine thematischen Signalsnapshots" message="Nach einer erfolgreichen Trend-Ingestion werden beobachtete Trends und Emerging Signals getrennt ausgewiesen." /></section>}
          </TabsContent>

          <TabsContent value="opportunities" className="tab-space">
            <div className="workflow-section-intro"><p className="section-kicker">Transparente Komponentenscores</p><h2>Mögliche Research Opportunities</h2><p>Die Rangfolge verwendet ausschliesslich bereits gespeicherte Block‑6-Komponenten. Datenqualität und widersprüchliche Signale bleiben bei jedem Themencluster sichtbar.</p></div>
            {opportunitySignals.length > 0 ? <section className="opportunity-list">{opportunitySignals.map((signal) => <OpportunityCard key={signal.theme} signal={signal} />)}</section> : <section className="panel"><EmptyState title="Keine Opportunity-Snapshots" message="Nach einer erfolgreichen Trend-Ingestion erscheinen hier nachvollziehbare Komponenten – niemals statische Ersatzwerte." /></section>}
          </TabsContent>

          <TabsContent value="method" className="tab-space">
            <section className="method-grid">
              <article className="panel method-card method-wide"><div className="method-icon"><Database /></div><p className="section-kicker">Datenbasis</p><h2>Versionierte Suche und Themenanalyse</h2><p>Das Dashboard liest den persistenten D1-Datenbestand. <code>core</code> durchsucht kuratierte Journals und Konferenzen, <code>broad</code> sucht feldweit ohne feste Quellenliste, und <code>frontier</code> kombiniert frühe OpenAlex-Signale mit einer direkten arXiv-Abfrage. Crossref ergänzt ausschliesslich DOI-basierte Metadaten und erzeugt keine zusätzlichen Treffer.</p><p>Die Themenklassifikation verwendet exakte normalisierte Wort- und Phrasengrenzen in Titel, Abstract, Keywords und OpenAlex Topics. Titel zählen +{data.themeAnalysis.weights.title}, Abstractbegriffe +{data.themeAnalysis.weights.abstract}, Keywords +{data.themeAnalysis.weights.keyword} und OpenAlex Topics +{data.themeAnalysis.weights.openalex_topic}; ab Score {data.themeAnalysis.scoreThreshold} wird ein Thema zugeordnet. Der Score erklärt eine Zuordnung und ist kein Qualitätsmass.</p><p className="method-note">Analyse {data.analysisVersion} · Klassifikation {data.themeAnalysis.classificationVersion} · Ontologie {data.themeAnalysis.ontologyVersion} · Abfrage {data.queryVersion} · Cache {formatCacheDuration(data.cacheDurationSeconds)}, danach max. {formatCacheDuration(data.staleWhileRevalidateSeconds)} während Revalidierung</p><a href="https://help.openalex.org/api/" target="_blank" rel="noreferrer">OpenAlex API-Dokumentation <ArrowUpRight /></a></article>
              <article className="panel method-card"><div className="method-icon"><BookOpen /></div><p className="section-kicker">Kuratiertes Journalset</p><h2>{data.sources.journals.length} Kernjournals</h2><div className="source-list">{data.sources.journals.map((source) => <div key={source.id}><span>{source.name}</span><small>{source.area}</small></div>)}</div></article>
              <article className="panel method-card"><div className="method-icon"><FileClock /></div><p className="section-kicker">Frontier-Radar</p><h2>Frühe Forschungssignale</h2><div className="source-cloud">{data.sources.preprints.map((source) => <Badge key={source.id} variant="outline">{source.name}</Badge>)}</div><p className="method-note">Preprints und Proceedings bleiben als eigene Versionen und Typen sichtbar; sie werden niemals als Journalartikel dargestellt.</p></article>
              <article className="panel method-card method-wide"><div className="method-icon"><TrendingUp /></div><p className="section-kicker">Trend- und Opportunity-Methode</p><h2>Gleich lange Fenster, sichtbare Komponenten</h2><p>Kurzfristig werden zwei abgeschlossene {data.trendAnalysis.method.shortWindowYears}-Jahresfenster, langfristig zwei abgeschlossene {data.trendAnalysis.method.longWindowYears}-Jahresfenster verglichen. Die Beschleunigung ist die Differenz zweier aufeinanderfolgender kurzfristiger Wachstumsraten. {data.trendAnalysis.method.changePoint}</p><p>{data.trendAnalysis.method.opportunity}</p><p className="method-note">Signalsnapshot {data.trendAnalysis.snapshotVersion} · Analyse {data.trendAnalysis.analysisVersion} · stabil bis {data.trendAnalysis.latestStableYear}</p></article>
              <article className="panel method-card method-wide quality-control-card"><div className="method-icon"><ShieldCheck /></div><p className="section-kicker">Automatische Datenqualitätskontrolle</p><h2>Plausibilitätswarnungen und manueller Audit</h2><p>Die Prüfungen verändern oder verwerfen keine Quelldaten. Sie markieren ungewöhnliche Trefferzahlen, Quellenrückgänge, Duplikatanteile, Abstract-Lücken, veraltete Läufe und Quellenausfälle zur manuellen Kontrolle.</p><div className="quality-control-summary"><span className={`quality-state ${data.quality.status === "live" ? "sufficient" : data.quality.status === "partial" ? "limited" : "unavailable"}`}>{data.quality.warnings.length} Warnungen · {data.quality.status}</span><span>Prüfung {data.quality.version} · {data.quality.checkedRunCount} jüngste Läufe</span></div>{data.quality.warnings.length > 0 ? <ul className="quality-warning-list">{data.quality.warnings.slice(0, 8).map((warning) => <li key={warning.id} className={warning.severity}><strong>{warning.source} · {warning.searchLayer}</strong><span>{warning.message}</span><small>Run {warning.ingestionRunId}</small></li>)}</ul> : <p className="method-note">Für die geprüften jüngsten Läufe wurde kein konfigurierter Plausibilitätsschwellenwert überschritten.</p>}<div className="audit-actions"><Button asChild variant="outline"><a href={`/api/audit/export?scope=${scope}`}><Download />Audit-CSV exportieren</a></Button><p>Die Spalten <code>manual_label</code> und <code>manual_note</code> bleiben leer. Zulässige Labels sind <code>relevant</code>, <code>irrelevant</code> und <code>unclear</code>; keine Bewertung wird automatisch erfunden.</p></div><p className="method-note">Goldstandard {data.methodology.evaluation.goldStandardVersion} · {data.methodology.evaluation.manuallyLabeledCount} manuell geprüfte Einträge · Precision {data.methodology.evaluation.precision === null ? "nicht berechnet" : percentage(data.methodology.evaluation.precision * 100)} · Recall {data.methodology.evaluation.recall === null ? "nicht berechnet" : percentage(data.methodology.evaluation.recall * 100)}</p></article>
              <article className="panel method-card method-wide limitations-card"><div className="method-icon"><ShieldCheck /></div><p className="section-kicker">Wichtige Grenzen</p><h2>So solltest du die Signale lesen</h2><ul><li>Das Journalset ist kuratiert, aber nicht abschliessend; es kann später erweitert werden.</li><li>OpenAlex-Topics sind maschinell abgeleitet. Klassifikations- und Indexierungsfehler bleiben möglich.</li><li>Die Trendzahlen zählen Publikationsmanifestationen, nicht zwingend einzigartige Forschungsprojekte; Preprint- und Journalversionen können separat vorkommen.</li><li>Calls zeigen institutionelle Nachfrage und Agenda-Setzung, nicht wissenschaftliche Evidenz oder erwartete Publikationsmengen. Sie bleiben als eigene Komponente sichtbar.</li><li>{trendYtdYear} ist unvollständig, bleibt ausserhalb der Vergleiche und wird separat angezeigt. Innerhalb der Indexierungsreserve kann zusätzlich das letzte abgeschlossene Jahr ausgeschlossen werden.</li><li>Observed Trend, Emerging Signal und Opportunity-Muster sind explorative, regelbasierte Einordnungen mit Mindestfallzahlen und sichtbarer Unsicherheit. Für belastbare Aussagen braucht es anschliessend ein systematisches Review oder eine bibliometrische Analyse.</li></ul></article>
            </section>
          </TabsContent>
        </> : null}
      </Tabs>

      <footer className="dashboard-footer"><span>Human–AI Research Radar</span><span>{data ? `Dashboard-Abfrage: ${formatDateTime(data.dashboardQueriedAt)}` : "Daten werden vorbereitet"}</span><span>{data ? `Analyse ${data.analysisVersion} · Abfrage ${data.queryVersion}` : "Exploratives Forschungsinstrument"}</span></footer>
    </main>
  );
}
