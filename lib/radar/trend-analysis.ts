import type {
  RadarOpportunityComponent,
  RadarThemeTrendSignal,
  RadarTrendAnalysis,
  RadarTrendWindow,
  TrendDataQualityStatus,
} from "@/app/radar-types";
import {
  CHANGE_POINT_Z_THRESHOLD,
  GROWTH_SIGNAL_THRESHOLD_PERCENT,
  INDEXING_LAG_DAYS,
  LONG_TREND_WINDOW_YEARS,
  MINIMUM_TREND_PUBLICATIONS,
  OPPORTUNITY_COMPONENT_MAX,
  SHORT_TREND_WINDOW_YEARS,
  STRATEGIC_FIT,
  TREND_ANALYSIS_VERSION,
  TREND_COMPARISON_FIELD_LABELS,
  TREND_SNAPSHOT_VERSION,
} from "./config/trend-analysis.v1";
import { THEME_ONTOLOGY } from "./config/themes.v2";

export type TrendPublicationRecord = {
  id: string;
  year: number;
  type: "journal" | "preprint" | "proceedings";
  venue: string;
  providers: string[];
  themes: string[];
};

export type TrendComparisonYear = {
  year: number;
  article: number | null;
  preprint: number | null;
};

export type TrendAgendaInput = {
  theme: string;
  activeCalls: number;
  closingCalls: number;
};

export type TrendAnalysisInput = {
  records: TrendPublicationRecord[];
  comparison: TrendComparisonYear[];
  agenda: TrendAgendaInput[];
  scope: "ai" | "field";
  capturedAt: string;
  corpusComplete: boolean;
  denominatorComplete: boolean;
  callsAvailable: boolean;
  additionalQualityIssues?: string[];
};

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(part: number, total: number) {
  return total > 0 ? round((part / total) * 100) : null;
}

function growthPercent(recent: RadarTrendWindow, previous: RadarTrendWindow) {
  if (recent.absoluteCount < MINIMUM_TREND_PUBLICATIONS || previous.absoluteCount < MINIMUM_TREND_PUBLICATIONS || previous.absoluteCount === 0) return null;
  return round(((recent.absoluteCount - previous.absoluteCount) / previous.absoluteCount) * 100);
}

export function latestStableCompleteYear(now: Date | string) {
  const date = typeof now === "string" ? new Date(now) : now;
  const year = date.getUTCFullYear();
  const firstDay = Date.UTC(year, 0, 1);
  const elapsedDays = Math.floor((date.getTime() - firstDay) / 86_400_000) + 1;
  return year - (elapsedDays <= INDEXING_LAG_DAYS ? 2 : 1);
}

function comparisonCount(input: TrendComparisonYear[], expectedYears: number) {
  if (input.length !== expectedYears || input.some((year) => year.article === null || year.preprint === null)) return null;
  return input.reduce((sum, year) => sum + Number(year.article) + Number(year.preprint), 0);
}

function windowMetric(
  records: TrendPublicationRecord[],
  comparison: TrendComparisonYear[],
  startYear: number,
  endYear: number,
): RadarTrendWindow {
  const selected = records.filter((record) => record.year >= startYear && record.year <= endYear);
  const journalCount = selected.filter((record) => record.type === "journal").length;
  const preprintCount = selected.filter((record) => record.type === "preprint").length;
  const proceedingsCount = selected.filter((record) => record.type === "proceedings").length;
  const absoluteCount = selected.length;
  const normalizedCount = journalCount + preprintCount;
  const fieldCount = comparisonCount(comparison.filter((year) => year.year >= startYear && year.year <= endYear), endYear - startYear + 1);
  return {
    startYear,
    endYear,
    yearCount: endYear - startYear + 1,
    absoluteCount,
    normalizedCount,
    comparisonFieldCount: fieldCount,
    perThousand: fieldCount && fieldCount > 0 ? round((normalizedCount / fieldCount) * 1_000, 2) : null,
    journalCount,
    preprintCount,
    proceedingsCount,
    journalShare: percent(journalCount, absoluteCount),
    preprintShare: percent(preprintCount, absoluteCount),
  };
}

export function detectEqualWindowChangePoint(recentCount: number, previousCount: number) {
  if (recentCount < MINIMUM_TREND_PUBLICATIONS || previousCount < MINIMUM_TREND_PUBLICATIONS) {
    return { detected: false, direction: "insufficient" as const, zScore: null, threshold: CHANGE_POINT_Z_THRESHOLD };
  }
  const denominator = Math.sqrt(recentCount + previousCount);
  const zScore = denominator > 0 ? round((recentCount - previousCount) / denominator, 2) : 0;
  const detected = Math.abs(zScore) >= CHANGE_POINT_Z_THRESHOLD;
  return {
    detected,
    direction: detected ? zScore > 0 ? "up" as const : "down" as const : "none" as const,
    zScore,
    threshold: CHANGE_POINT_Z_THRESHOLD,
  };
}

function diversity(records: TrendPublicationRecord[]) {
  const sources = new Set(records.flatMap((record) => record.providers));
  const venues = new Map<string, number>();
  for (const record of records) venues.set(record.venue, (venues.get(record.venue) ?? 0) + 1);
  const total = records.length;
  const shares = [...venues.values()].map((count) => count / Math.max(total, 1));
  const entropy = shares.reduce((sum, share) => sum - share * Math.log(share), 0);
  const maximumEntropy = venues.size > 1 ? Math.log(venues.size) : 0;
  return {
    sourceCount: sources.size,
    venueCount: venues.size,
    venueDiversityPercent: total > 0 ? maximumEntropy > 0 ? round((entropy / maximumEntropy) * 100) : 0 : null,
    largestVenueShare: total > 0 ? round(Math.max(...shares) * 100) : null,
  };
}

function qualityStatus(input: {
  recent: RadarTrendWindow;
  comparisonAvailable: boolean;
  corpusComplete: boolean;
  denominatorComplete: boolean;
  callsAvailable: boolean;
  shortGrowth: number | null;
  longGrowth: number | null;
  totalRecords: number;
  additionalIssues: string[];
}) {
  const issues = [...input.additionalIssues];
  if (input.totalRecords === 0 && !input.comparisonAvailable) {
    issues.push("Weder thematische Publikationsdaten noch ein Vergleichsfeld sind verfügbar.");
    return { status: "unavailable" as const, issues };
  }
  if (input.recent.absoluteCount < MINIMUM_TREND_PUBLICATIONS) issues.push(`Das jüngste Vergleichsfenster enthält weniger als ${MINIMUM_TREND_PUBLICATIONS} Publikationsdatensätze.`);
  if (!input.comparisonAvailable) issues.push("Der Nenner des relevanten Vergleichsfelds ist nicht vollständig verfügbar.");
  if (!input.corpusComplete) issues.push("Mindestens ein Discovery-Lauf fehlt, war partiell oder erreichte sein Sicherheitslimit.");
  if (!input.denominatorComplete) issues.push("Die Vergleichsfeld-Zeitreihe ist nur teilweise verfügbar.");
  if (!input.callsAvailable) issues.push("Das Agenda-Signal aus Calls ist nicht vollständig verifiziert.");
  if (input.shortGrowth === null) issues.push("Kurzfristiges Wachstum unterschreitet die Mindestfallzahl in mindestens einem Fenster.");
  if (input.longGrowth === null) issues.push("Langfristiges Wachstum unterschreitet die Mindestfallzahl in mindestens einem Fenster.");
  if (input.recent.absoluteCount < MINIMUM_TREND_PUBLICATIONS || !input.comparisonAvailable) {
    return { status: "insufficient" as const, issues: [...new Set(issues)] };
  }
  if (issues.length > 0) return { status: "limited" as const, issues: [...new Set(issues)] };
  return { status: "sufficient" as const, issues: [] };
}

function observedTrend(shortGrowth: number | null, longGrowth: number | null, recent: RadarTrendWindow, previous: RadarTrendWindow) {
  if (shortGrowth === null) return {
    status: "insufficient" as const,
    interpretation: `Mit ${recent.absoluteCount} beziehungsweise ${previous.absoluteCount} Datensätzen in den jüngsten gleich langen Fenstern wird kein Publikationstrend behauptet.`,
  };
  const shortDirection = shortGrowth === null ? 0 : shortGrowth > GROWTH_SIGNAL_THRESHOLD_PERCENT ? 1 : shortGrowth < -GROWTH_SIGNAL_THRESHOLD_PERCENT ? -1 : 0;
  const longDirection = longGrowth === null ? 0 : longGrowth > GROWTH_SIGNAL_THRESHOLD_PERCENT ? 1 : longGrowth < -GROWTH_SIGNAL_THRESHOLD_PERCENT ? -1 : 0;
  if (shortDirection && longDirection && shortDirection !== longDirection) return {
    status: "mixed" as const,
    interpretation: `Kurzfristige Veränderung ${shortGrowth}% und langfristige Veränderung ${longGrowth}% weisen in unterschiedliche Richtungen.`,
  };
  const direction = shortDirection || longDirection;
  if (direction > 0) return {
    status: "growing" as const,
    interpretation: `Gleich lange abgeschlossene Fenster zeigen ${shortGrowth === null ? "keine belastbare kurzfristige Rate" : `${shortGrowth}% kurzfristige Veränderung`} und ${longGrowth === null ? "keine belastbare langfristige Rate" : `${longGrowth}% langfristige Veränderung`}.`,
  };
  if (direction < 0) return {
    status: "declining" as const,
    interpretation: `Gleich lange abgeschlossene Fenster zeigen ${shortGrowth === null ? "keine belastbare kurzfristige Rate" : `${shortGrowth}% kurzfristige Veränderung`} und ${longGrowth === null ? "keine belastbare langfristige Rate" : `${longGrowth}% langfristige Veränderung`}.`,
  };
  return {
    status: "stable" as const,
    interpretation: `Die belastbaren Veränderungen bleiben innerhalb von ±${GROWTH_SIGNAL_THRESHOLD_PERCENT}% und werden als stabil eingeordnet.`,
  };
}

function emergingSignal(changePoint: ReturnType<typeof detectEqualWindowChangePoint>, shortGrowth: number | null, preprintShare: number | null) {
  if (shortGrowth === null || preprintShare === null) return {
    status: "insufficient" as const,
    interpretation: "Für ein Emerging Signal reichen Mindestfallzahl oder Publikationstypen im jüngsten abgeschlossenen Fenster nicht aus.",
  };
  if (changePoint.detected && changePoint.direction === "up" && preprintShare >= 25) return {
    status: "burst" as const,
    interpretation: `Der Zwei-Fenster-Test erkennt einen Aufwärtswechsel (z=${changePoint.zScore}); zugleich liegt der Preprint-Anteil bei ${preprintShare}%. Dies ist ein exploratives Frühsignal.`,
  };
  if (shortGrowth > GROWTH_SIGNAL_THRESHOLD_PERCENT || preprintShare >= 35) return {
    status: "rising" as const,
    interpretation: `Kurzfristige Veränderung (${shortGrowth}%) und Preprint-Anteil (${preprintShare}%) bilden ein exploratives Emerging Signal ohne Richtungsversprechen.`,
  };
  if (shortGrowth < -GROWTH_SIGNAL_THRESHOLD_PERCENT) return {
    status: "cooling" as const,
    interpretation: `Die kurzfristige Veränderung liegt bei ${shortGrowth}%; das frühe Signal schwächt sich im abgeschlossenen Vergleichsfenster ab.`,
  };
  return {
    status: "stable" as const,
    interpretation: `Kurzfristige Veränderung (${shortGrowth}%) und Preprint-Anteil (${preprintShare}%) zeigen kein ausgeprägtes Frühsignal.`,
  };
}

function agendaSignal(activeCalls: number, closingCalls: number, available: boolean) {
  if (!available) return {
    status: "unavailable" as const,
    activeCalls,
    closingCalls,
    interpretation: "Das aktuelle Calls-Signal ist nicht vollständig verifiziert und wird separat als nicht verfügbar ausgewiesen.",
  };
  if (activeCalls >= 3 || closingCalls >= 2) return {
    status: "strong" as const,
    activeCalls,
    closingCalls,
    interpretation: `${activeCalls} aktive Calls, davon ${closingCalls} mit naher Deadline, bilden ein starkes institutionelles Agenda-Signal.`,
  };
  if (activeCalls > 0) return {
    status: "moderate" as const,
    activeCalls,
    closingCalls,
    interpretation: `${activeCalls} aktive Calls bilden ein moderates institutionelles Agenda-Signal.`,
  };
  return {
    status: "weak" as const,
    activeCalls,
    closingCalls,
    interpretation: "Es liegen keine verifizierten aktiven Calls für dieses Thema vor.",
  };
}

function opportunityComponents(input: {
  theme: string;
  agenda: ReturnType<typeof agendaSignal>;
  emerging: ReturnType<typeof emergingSignal>;
  recent: RadarTrendWindow;
  shortGrowth: number | null;
}): RadarOpportunityComponent[] {
  const agendaScore = input.agenda.status === "unavailable" ? 0 : Math.min(OPPORTUNITY_COMPONENT_MAX, input.agenda.activeCalls * 5 + input.agenda.closingCalls * 3);
  const preprintShare = input.recent.preprintShare ?? 0;
  const positiveGrowth = Math.max(0, input.shortGrowth ?? 0);
  const emergingScore = Math.min(OPPORTUNITY_COMPONENT_MAX, round(Math.min(15, preprintShare * 0.375) + Math.min(10, positiveGrowth * 0.2)));
  const journalShare = input.recent.journalShare;
  const saturationScore = journalShare === null ? 0 : round(Math.max(0, OPPORTUNITY_COMPONENT_MAX * (1 - journalShare / 100)));
  const strategic = STRATEGIC_FIT[input.theme] ?? { score: 0, rationale: "Keine strategische Passung konfiguriert." };
  return [
    { key: "agenda", label: "Calls-/Agenda-Signal", score: agendaScore, maximum: 25, rationale: input.agenda.interpretation },
    { key: "emerging", label: "Preprint- und Wachstumssignal", score: emergingScore, maximum: 25, rationale: `${input.emerging.interpretation} Komponentenbasis: ${preprintShare}% Preprints und ${input.shortGrowth === null ? "keine belastbare kurzfristige Veränderung" : `${input.shortGrowth}% kurzfristige Veränderung`}.` },
    { key: "low_peer_reviewed_saturation", label: "Geringe Journal-Sättigung", score: saturationScore, maximum: 25, rationale: journalShare === null ? "Publikationstypen reichen für diese Komponente nicht aus." : `Journalanteil im jüngsten abgeschlossenen Fenster: ${journalShare}%.` },
    { key: "strategic_fit", label: "Strategische Passung", score: strategic.score, maximum: 25, rationale: strategic.rationale },
  ];
}

function contradictions(input: {
  observed: ReturnType<typeof observedTrend>;
  emerging: ReturnType<typeof emergingSignal>;
  agenda: ReturnType<typeof agendaSignal>;
  shortGrowth: number | null;
  longGrowth: number | null;
  journalShare: number | null;
}) {
  const values: string[] = [];
  if (input.agenda.status === "strong" && input.observed.status === "declining") values.push("Starkes Calls-Signal bei rückläufiger beobachteter Publikationsaktivität.");
  if ((input.emerging.status === "burst" || input.emerging.status === "rising") && input.agenda.status === "weak") values.push("Frühes Publikationssignal ohne entsprechendes aktuelles Calls-Signal.");
  if (input.shortGrowth !== null && input.longGrowth !== null && Math.sign(input.shortGrowth) !== Math.sign(input.longGrowth) && input.shortGrowth !== 0 && input.longGrowth !== 0) values.push("Kurz- und langfristige Veränderung weisen in unterschiedliche Richtungen.");
  if (input.agenda.status === "strong" && input.journalShare !== null && input.journalShare >= 75) values.push("Starkes Agenda-Signal trifft auf einen bereits hohen Journalanteil.");
  return values;
}

function opportunity(
  components: RadarOpportunityComponent[],
  quality: TrendDataQualityStatus,
  conflicts: string[],
) {
  if (quality === "insufficient" || quality === "unavailable") return {
    status: "insufficient" as const,
    score: null,
    maximum: 100 as const,
    components,
    interpretation: "Wegen unzureichender Datenqualität wird kein Opportunity Score ausgewiesen.",
  };
  const score = Math.round(components.reduce((sum, component) => sum + component.score, 0));
  if (conflicts.length > 0) return {
    status: "mixed" as const,
    score,
    maximum: 100 as const,
    components,
    interpretation: `Der transparente Komponentenscore beträgt ${score}/100, enthält aber widersprüchliche Signale und wird deshalb als gemischt ausgewiesen.`,
  };
  if (score >= 65) return {
    status: "possible" as const,
    score,
    maximum: 100 as const,
    components,
    interpretation: `Der transparente Komponentenscore beträgt ${score}/100 und markiert eine mögliche Research Opportunity zur weiteren Prüfung.`,
  };
  if (score >= 45) return {
    status: "mixed" as const,
    score,
    maximum: 100 as const,
    components,
    interpretation: `Der transparente Komponentenscore beträgt ${score}/100; die Komponenten ergeben kein einheitliches Opportunity-Muster.`,
  };
  return {
    status: "low" as const,
    score,
    maximum: 100 as const,
    components,
    interpretation: `Der transparente Komponentenscore beträgt ${score}/100 und zeigt im aktuellen Datenstand nur ein schwaches Opportunity-Muster.`,
  };
}

function buildThemeSignal(input: TrendAnalysisInput, theme: string, label: string, stableEndYear: number): RadarThemeTrendSignal {
  const records = input.records.filter((record) => record.themes.includes(theme));
  const shortRecent = windowMetric(records, input.comparison, stableEndYear - 1, stableEndYear);
  const shortPrevious = windowMetric(records, input.comparison, stableEndYear - 3, stableEndYear - 2);
  const shortBaseline = windowMetric(records, input.comparison, stableEndYear - 5, stableEndYear - 4);
  const longRecent = windowMetric(records, input.comparison, stableEndYear - 3, stableEndYear);
  const longPrevious = windowMetric(records, input.comparison, stableEndYear - 7, stableEndYear - 4);
  const shortGrowth = growthPercent(shortRecent, shortPrevious);
  const previousShortGrowth = growthPercent(shortPrevious, shortBaseline);
  const longGrowth = growthPercent(longRecent, longPrevious);
  const accelerationPoints = shortGrowth !== null && previousShortGrowth !== null ? round(shortGrowth - previousShortGrowth) : null;
  const acceleration = accelerationPoints === null ? "insufficient" as const : Math.abs(accelerationPoints) < 10 ? "steady" as const : accelerationPoints > 0 ? "accelerating" as const : "slowing" as const;
  const changePoint = detectEqualWindowChangePoint(shortRecent.absoluteCount, shortPrevious.absoluteCount);
  const recentRecords = records.filter((record) => record.year >= shortRecent.startYear && record.year <= shortRecent.endYear);
  const observed = observedTrend(shortGrowth, longGrowth, shortRecent, shortPrevious);
  const emerging = emergingSignal(changePoint, shortGrowth, shortRecent.preprintShare);
  const agendaInput = input.agenda.find((item) => item.theme === theme);
  const agenda = agendaSignal(agendaInput?.activeCalls ?? 0, agendaInput?.closingCalls ?? 0, input.callsAvailable);
  const quality = qualityStatus({
    recent: shortRecent,
    comparisonAvailable: shortRecent.comparisonFieldCount !== null,
    corpusComplete: input.corpusComplete,
    denominatorComplete: input.denominatorComplete,
    callsAvailable: input.callsAvailable,
    shortGrowth,
    longGrowth,
    totalRecords: records.length,
    additionalIssues: input.additionalQualityIssues ?? [],
  });
  const conflicts = contradictions({ observed, emerging, agenda, shortGrowth, longGrowth, journalShare: shortRecent.journalShare });
  const components = opportunityComponents({ theme, agenda, emerging, recent: shortRecent, shortGrowth });
  const currentYear = new Date(input.capturedAt).getUTCFullYear();
  const annual = [];
  for (let year = stableEndYear - 7; year <= currentYear; year += 1) {
    const metric = windowMetric(records, input.comparison, year, year);
    annual.push({
      year,
      absoluteCount: metric.absoluteCount,
      journalCount: metric.journalCount,
      preprintCount: metric.preprintCount,
      proceedingsCount: metric.proceedingsCount,
      comparisonFieldCount: metric.comparisonFieldCount,
      perThousand: metric.perThousand,
      partial: year === currentYear || year > stableEndYear,
      excludedFromComparisons: year > stableEndYear,
    });
  }
  return {
    theme,
    label,
    snapshotVersion: TREND_SNAPSHOT_VERSION,
    analysisVersion: TREND_ANALYSIS_VERSION,
    capturedAt: input.capturedAt,
    stableEndYear,
    currentYear: {
      year: currentYear,
      count: records.filter((record) => record.year === currentYear).length,
      partial: true,
      includedInComparisons: false,
    },
    windows: { shortRecent, shortPrevious, shortBaseline, longRecent, longPrevious },
    shortGrowthPercent: shortGrowth,
    longGrowthPercent: longGrowth,
    accelerationPercentagePoints: accelerationPoints,
    acceleration,
    changePoint: {
      ...changePoint,
      method: `Zweiseitiger Poisson-Näherungstest für zwei gleich lange ${SHORT_TREND_WINDOW_YEARS}-Jahresfenster; Schwelle |z| ≥ ${CHANGE_POINT_Z_THRESHOLD}.`,
    },
    diversity: diversity(recentRecords),
    observedTrend: observed,
    emergingSignal: emerging,
    agendaSignal: agenda,
    opportunity: opportunity(components, quality.status, conflicts),
    dataQuality: {
      status: quality.status,
      minimumPublications: MINIMUM_TREND_PUBLICATIONS,
      recentWindowCount: shortRecent.absoluteCount,
      issues: quality.issues,
    },
    contradictions: conflicts,
    annual,
  };
}

export function buildTrendAnalysis(input: TrendAnalysisInput): RadarTrendAnalysis {
  const captured = new Date(input.capturedAt);
  const currentYear = captured.getUTCFullYear();
  const stableEndYear = latestStableCompleteYear(captured);
  const themes = THEME_ONTOLOGY.map((theme) => buildThemeSignal(input, theme.id, theme.label, stableEndYear));
  const hasData = input.records.length > 0 || input.comparison.length > 0;
  const allSufficient = themes.every((theme) => theme.dataQuality.status === "sufficient");
  return {
    status: !hasData
      ? { status: "unavailable", error: "Trend- und Opportunity-Analyse: Noch kein auswertbarer Snapshot vorhanden." }
      : allSufficient
        ? { status: "live", error: null }
        : { status: "partial", error: "Trend- und Opportunity-Analyse: Mindestens ein Themencluster weist begrenzte oder unzureichende Datenqualität auf." },
    snapshotAt: input.capturedAt,
    snapshotVersion: TREND_SNAPSHOT_VERSION,
    analysisVersion: TREND_ANALYSIS_VERSION,
    scope: input.scope,
    comparisonField: TREND_COMPARISON_FIELD_LABELS[input.scope],
    currentYear,
    currentYearExcluded: true,
    latestStableYear: stableEndYear,
    indexingLagDays: INDEXING_LAG_DAYS,
    excludedForIndexingLag: stableEndYear < currentYear - 1 ? [currentYear - 1] : [],
    minimumPublications: MINIMUM_TREND_PUBLICATIONS,
    themes,
    method: {
      shortWindowYears: SHORT_TREND_WINDOW_YEARS,
      longWindowYears: LONG_TREND_WINDOW_YEARS,
      changePoint: `Zweiseitiger Poisson-Näherungstest auf zwei gleich langen ${SHORT_TREND_WINDOW_YEARS}-Jahresfenstern bei |z| ≥ ${CHANGE_POINT_Z_THRESHOLD}.`,
      opportunity: "Additive, sichtbare Komponenten zu je maximal 25 Punkten: Agenda, Emerging Signal, geringe Journal-Sättigung und strategische Passung. Bei unzureichender Datenqualität wird kein Gesamtscore ausgewiesen.",
    },
  };
}
