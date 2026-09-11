import { callTimeStatus } from "../../site/assets/js/research.js";
import { classifyRecord } from "./classification.mjs";
import {
  INDEXING_LAG_DAYS, LONG_WINDOW_YEARS, MINIMUM_TREND_RECORDS, OPPORTUNITY_METHOD_VERSION,
  SHORT_WINDOW_YEARS, THEMES, TREND_METHOD_VERSION
} from "./ontology.v3.mjs";

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(part, total) {
  return total > 0 ? round((part / total) * 100, 1) : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function latestStableYear(now) {
  const date = now instanceof Date ? now : new Date(now);
  const currentYear = date.getUTCFullYear();
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(currentYear, 0, 1)) / 86_400_000) + 1;
  return currentYear - (dayOfYear <= INDEXING_LAG_DAYS ? 2 : 1);
}

function yearOf(work) {
  const year = Number(String(work.publicationDate ?? "").slice(0, 4));
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

function publicationType(work) {
  if (work.recordType === "preprint") return "preprint";
  const preferred = work.versions?.find((version) => version.id === work.preferredVersionId) ?? work.versions?.[0];
  return preferred?.type === "proceedings" ? "proceedings" : preferred?.type === "preprint" ? "preprint" : "journal";
}

function providers(work) {
  const discovered = (work.discoveredBy ?? []).map((entry) => entry.provider);
  return [...new Set([...discovered, work.source?.name].filter(Boolean).map((provider) => provider.trim().toLocaleLowerCase("en")))];
}

function trendRecords(works) {
  return works.flatMap((work) => {
    const year = yearOf(work);
    if (!year) return [];
    return [{
      id: work.id,
      year,
      type: publicationType(work),
      venue: work.venue ?? "Unknown venue",
      providers: providers(work),
      themes: work.classifiedThemes.map((theme) => theme.theme),
      citedByCount: work.citedByCount ?? 0
    }];
  });
}

function windowMetric(themeRecords, allRecords, startYear, endYear) {
  const selected = themeRecords.filter((record) => record.year >= startYear && record.year <= endYear);
  const denominator = allRecords.filter((record) => record.year >= startYear && record.year <= endYear).length;
  const journalCount = selected.filter((record) => record.type === "journal").length;
  const preprintCount = selected.filter((record) => record.type === "preprint").length;
  const proceedingsCount = selected.filter((record) => record.type === "proceedings").length;
  return {
    startYear,
    endYear,
    yearCount: endYear - startYear + 1,
    absoluteCount: selected.length,
    eligibleCorpusCount: denominator,
    normalizedRatePer1000: denominator > 0 ? round((selected.length / denominator) * 1_000, 2) : null,
    journalCount,
    preprintCount,
    proceedingsCount,
    journalShare: percent(journalCount, selected.length),
    preprintShare: percent(preprintCount, selected.length)
  };
}

function growth(recent, previous) {
  if (recent.absoluteCount < MINIMUM_TREND_RECORDS || previous.absoluteCount < MINIMUM_TREND_RECORDS) {
    return { absolutePercent: null, normalizedPercent: null };
  }
  const absolutePercent = previous.absoluteCount > 0
    ? round(((recent.absoluteCount - previous.absoluteCount) / previous.absoluteCount) * 100)
    : null;
  const normalizedPercent = recent.normalizedRatePer1000 !== null && previous.normalizedRatePer1000
    ? round(((recent.normalizedRatePer1000 - previous.normalizedRatePer1000) / previous.normalizedRatePer1000) * 100)
    : null;
  return { absolutePercent, normalizedPercent };
}

function trendStatus(shortGrowth, longGrowth) {
  if (shortGrowth === null || longGrowth === null) return "insufficient";
  const direction = (value) => value > 15 ? 1 : value < -15 ? -1 : 0;
  const short = direction(shortGrowth);
  const long = direction(longGrowth);
  if (short && long && short !== long) return "mixed";
  if (short || long) return (short || long) > 0 ? "growing" : "declining";
  return "stable";
}

function diversity(records) {
  const sourceCount = new Set(records.flatMap((record) => record.providers)).size;
  const venueCounts = new Map();
  records.forEach((record) => venueCounts.set(record.venue, (venueCounts.get(record.venue) ?? 0) + 1));
  const shares = [...venueCounts.values()].map((count) => count / Math.max(records.length, 1));
  const entropy = shares.reduce((sum, share) => sum - share * Math.log(share), 0);
  const maximumEntropy = venueCounts.size > 1 ? Math.log(venueCounts.size) : 0;
  return {
    sourceCount,
    venueCount: venueCounts.size,
    venueDiversityPercent: records.length === 0 ? null : maximumEntropy > 0 ? round((entropy / maximumEntropy) * 100) : 0,
    largestVenueShare: records.length ? round(Math.max(...shares) * 100) : null
  };
}

function annualSeries(themeRecords, allRecords, startYear, currentYear, stableYear) {
  const output = [];
  for (let year = startYear; year <= currentYear; year += 1) {
    const metric = windowMetric(themeRecords, allRecords, year, year);
    output.push({
      year,
      absoluteCount: metric.absoluteCount,
      eligibleCorpusCount: metric.eligibleCorpusCount,
      normalizedRatePer1000: metric.normalizedRatePer1000,
      journalCount: metric.journalCount,
      preprintCount: metric.preprintCount,
      proceedingsCount: metric.proceedingsCount,
      partial: year > stableYear,
      excludedFromComparisons: year > stableYear
    });
  }
  return output;
}

function classifyCalls(calls) {
  return calls.map((call) => ({
    ...call,
    analysisThemes: classifyRecord({
      title: call.title,
      abstract: call.description,
      keywords: [],
      topics: call.topics ?? []
    }).map((classification) => classification.theme)
  }));
}

function agendaForTheme(theme, callsData, classifiedCalls) {
  const relevant = classifiedCalls.filter((call) => call.analysisThemes.includes(theme));
  const active = relevant.filter((call) => call.status === "open" || call.status === "closing-soon");
  const closing = active.filter((call) => call.status === "closing-soon");
  const verifiedSources = new Set(active.map((call) => call.sourceKey));
  const availability = callsData.status === "unavailable" ? "unavailable" : callsData.status === "partial" ? "partial" : "complete";
  return {
    theme,
    status: availability === "unavailable" ? "unavailable" : active.length >= 3 || closing.length >= 2 ? "strong" : active.length > 0 ? "moderate" : "weak",
    dataQuality: availability,
    activeCallCount: active.length,
    closingSoonCount: closing.length,
    sourceCount: verifiedSources.size,
    evidenceCallIds: active.map((call) => call.id),
    nearestDeadlineAt: active.map((call) => call.deadlineAt).filter(Boolean).sort()[0] ?? null
  };
}

function emergingForTheme(trend) {
  const growthValue = trend.growth.short.normalizedPercent;
  const preprintShare = trend.windows.shortRecent.preprintShare;
  let status = "insufficient";
  if (growthValue !== null && preprintShare !== null) {
    if (growthValue > 25 && preprintShare >= 20) status = "emerging";
    else if (growthValue > 15 || preprintShare >= 35) status = "rising";
    else if (growthValue < -15) status = "cooling";
    else status = "stable";
  }
  return {
    theme: trend.theme,
    label: trend.label,
    status,
    shortGrowthPercent: growthValue,
    recentPreprintShare: preprintShare,
    recentWorkCount: trend.windows.shortRecent.absoluteCount,
    evidenceWorkIds: trend.recentEvidenceWorkIds,
    minimumEvidenceRecords: MINIMUM_TREND_RECORDS
  };
}

function opportunityForTheme(trend, emerging, agenda, corpusComplete) {
  const components = [
    {
      key: "publication_momentum",
      maximum: 25,
      score: trend.growth.short.normalizedPercent === null ? null : round(clamp(12.5 + trend.growth.short.normalizedPercent / 8, 0, 25)),
      available: trend.growth.short.normalizedPercent !== null,
      inputs: { shortNormalizedGrowthPercent: trend.growth.short.normalizedPercent }
    },
    {
      key: "frontier_share",
      maximum: 25,
      score: trend.windows.shortRecent.absoluteCount < MINIMUM_TREND_RECORDS || trend.windows.shortRecent.preprintShare === null
        ? null
        : round(clamp(trend.windows.shortRecent.preprintShare / 4, 0, 25)),
      available: trend.windows.shortRecent.absoluteCount >= MINIMUM_TREND_RECORDS && trend.windows.shortRecent.preprintShare !== null,
      inputs: { recentPreprintShare: trend.windows.shortRecent.preprintShare }
    },
    {
      key: "agenda_demand",
      maximum: 25,
      score: agenda.status === "unavailable" ? null : Math.min(25, agenda.activeCallCount * 4 + agenda.closingSoonCount * 3),
      available: agenda.status !== "unavailable",
      inputs: { activeCalls: agenda.activeCallCount, closingSoonCalls: agenda.closingSoonCount }
    },
    {
      key: "source_diversity",
      maximum: 25,
      score: trend.windows.shortRecent.absoluteCount < MINIMUM_TREND_RECORDS || trend.sourceDiversity.recentWindow.venueDiversityPercent === null
        ? null
        : round(trend.sourceDiversity.recentWindow.venueDiversityPercent / 4),
      available: trend.windows.shortRecent.absoluteCount >= MINIMUM_TREND_RECORDS && trend.sourceDiversity.recentWindow.venueDiversityPercent !== null,
      inputs: {
        sourceCount: trend.sourceDiversity.recentWindow.sourceCount,
        venueCount: trend.sourceDiversity.recentWindow.venueCount,
        venueDiversityPercent: trend.sourceDiversity.recentWindow.venueDiversityPercent
      }
    }
  ];
  const missing = components.filter((component) => !component.available).map((component) => component.key);
  const reasons = [];
  if (missing.length) reasons.push(`Nicht verfügbare Komponenten: ${missing.join(", ")}.`);
  if (!corpusComplete) reasons.push("Der statische Publikationskorpus ist nur teilweise vollständig.");
  if (agenda.dataQuality !== "complete") reasons.push("Die Calls-Registry ist nur teilweise verfügbar.");
  const uncertainty = missing.length || !corpusComplete ? "high" : agenda.dataQuality !== "complete" ? "medium" : "low";
  const score = missing.length || !corpusComplete ? null : Math.round(components.reduce((sum, component) => sum + component.score, 0));
  return {
    theme: trend.theme,
    label: trend.label,
    status: score === null ? "insufficient" : score >= 65 ? "possible" : score >= 45 ? "mixed" : "low",
    score,
    maximum: 100,
    components,
    uncertainty: { level: uncertainty, reasons },
    evidenceWorkIds: trend.recentEvidenceWorkIds,
    evidenceCallIds: agenda.evidenceCallIds,
    methodVersion: OPPORTUNITY_METHOD_VERSION
  };
}

export function buildStaticMetrics(input) {
  const generatedAt = input.generatedAt;
  const now = new Date(generatedAt);
  const currentYear = now.getUTCFullYear();
  const stableYear = latestStableYear(now);
  const comparisonWorks = input.comparisonMode ? input.works.filter(work => work.discoveredBy?.some(d => d.mode === input.comparisonMode)) : input.works;
  const records = trendRecords(comparisonWorks);
  const calls = classifyCalls((input.calls.items ?? []).map(call => ({ ...call, status: callTimeStatus(call, now) })));
  const earliestWindowYear = stableYear - (LONG_WINDOW_YEARS * 2 - 1);
  const excludedYears = Array.from({ length: currentYear - stableYear }, (_, index) => stableYear + index + 1);

  const publicationTrends = THEMES.map((theme) => {
    const themed = records.filter((record) => record.themes.includes(theme.id));
    const shortRecent = windowMetric(themed, records, stableYear - 1, stableYear);
    const shortPrevious = windowMetric(themed, records, stableYear - 3, stableYear - 2);
    const shortBaseline = windowMetric(themed, records, stableYear - 5, stableYear - 4);
    const longRecent = windowMetric(themed, records, stableYear - 3, stableYear);
    const longPrevious = windowMetric(themed, records, stableYear - 7, stableYear - 4);
    const short = growth(shortRecent, shortPrevious);
    const previousShort = growth(shortPrevious, shortBaseline);
    const long = growth(longRecent, longPrevious);
    const acceleration = short.normalizedPercent !== null && previousShort.normalizedPercent !== null
      ? round(short.normalizedPercent - previousShort.normalizedPercent)
      : null;
    const recentRecords = themed.filter((record) => record.year >= shortRecent.startYear && record.year <= shortRecent.endYear);
    const reasons = [];
    if (shortRecent.absoluteCount < MINIMUM_TREND_RECORDS || shortPrevious.absoluteCount < MINIMUM_TREND_RECORDS) reasons.push(`Kurzfristige Fenster unterschreiten die Mindestfallzahl ${MINIMUM_TREND_RECORDS}.`);
    if (longRecent.absoluteCount < MINIMUM_TREND_RECORDS || longPrevious.absoluteCount < MINIMUM_TREND_RECORDS) reasons.push(`Langfristige Fenster unterschreiten die Mindestfallzahl ${MINIMUM_TREND_RECORDS}.`);
    if (shortRecent.eligibleCorpusCount === 0 || shortPrevious.eligibleCorpusCount === 0) reasons.push("Für mindestens ein kurzfristiges Fenster fehlt ein Korpusnenner.");
    if (!input.corpusComplete) reasons.push("Der Publikationskorpus ist nur teilweise vollständig.");
    const totals = windowMetric(themed, records, Math.min(...records.map((record) => record.year), currentYear), currentYear);
    return {
      theme: theme.id,
      label: theme.label,
      status: trendStatus(short.normalizedPercent, long.normalizedPercent),
      totals: {
        absoluteCount: themed.length,
        journalCount: themed.filter((record) => record.type === "journal").length,
        preprintCount: themed.filter((record) => record.type === "preprint").length,
        proceedingsCount: themed.filter((record) => record.type === "proceedings").length,
        journalShare: totals.journalShare,
        preprintShare: totals.preprintShare
      },
      windows: { shortRecent, shortPrevious, shortBaseline, longRecent, longPrevious },
      growth: { short, long },
      accelerationPercentagePoints: acceleration,
      acceleration: acceleration === null ? "insufficient" : Math.abs(acceleration) < 10 ? "steady" : acceleration > 0 ? "accelerating" : "slowing",
      sourceDiversity: { allCorpus: diversity(themed), recentWindow: diversity(recentRecords) },
      annual: annualSeries(themed, records, earliestWindowYear, currentYear, stableYear),
      recentEvidenceWorkIds: recentRecords.map((record) => record.id).slice(0, 20),
      dataQuality: { status: reasons.length ? "insufficient" : "sufficient", reasons }
    };
  });

  const emergingSignals = publicationTrends.map(emergingForTheme);
  const agendaSignals = THEMES.map((theme) => agendaForTheme(theme.id, input.calls, calls));
  const opportunities = publicationTrends.map((trend) => opportunityForTheme(
    trend,
    emergingSignals.find((signal) => signal.theme === trend.theme),
    agendaSignals.find((signal) => signal.theme === trend.theme),
    input.corpusComplete
  ));
  const missingAbstracts = input.works.filter((work) => !work.abstract).length;
  const warnings = [];
  if (excludedYears.length) warnings.push({ code: "running-or-indexing-lag-years-excluded", severity: "warning", message: `Aus Trendvergleichen ausgeschlossen: ${excludedYears.join(", ")}.`, affectedRecords: records.filter((record) => excludedYears.includes(record.year)).length });
  if (!records.some((record) => record.year <= stableYear)) warnings.push({ code: "no-stable-year-records", severity: "warning", message: "Der Korpus enthält keine Publikationen in vollständig abgeschlossenen Vergleichsjahren.", affectedRecords: records.length });
  if (!input.corpusComplete) warnings.push({ code: "partial-publication-corpus", severity: "warning", message: "Nicht alle vorgesehenen Suchmodi liegen im statischen Korpus vor.", affectedRecords: records.length });
  if (input.calls.status !== "ready") warnings.push({ code: "partial-agenda-sources", severity: "warning", message: "Agenda Signals beruhen auf einer nur teilweise verfügbaren offiziellen Calls-Registry.", affectedRecords: agendaSignals.reduce((sum, signal) => sum + signal.activeCallCount, 0) });
  if (missingAbstracts) warnings.push({ code: "missing-abstracts", severity: "info", message: `${missingAbstracts} Arbeiten besitzen kein Abstract; ihre Klassifikation nutzt die übrigen Felder.`, affectedRecords: missingAbstracts });

  return {
    status: warnings.length ? "partial" : "ready",
    methodology: {
      trendMethodVersion: TREND_METHOD_VERSION,
      opportunityMethodVersion: OPPORTUNITY_METHOD_VERSION,
      shortWindowYears: SHORT_WINDOW_YEARS,
      longWindowYears: LONG_WINDOW_YEARS,
      minimumTrendRecords: MINIMUM_TREND_RECORDS,
      normalization: `Themenpublikationen je 1.000 geeignete ${input.comparisonMode ?? "gesamte"}-Korpusarbeiten im identischen Kalenderfenster; kein externes Vergleichsfeld.`,
      currentYearExcluded: true,
      indexingLagDays: INDEXING_LAG_DAYS,
      opportunityRequiresAllComponents: true
    },
    coverage: {
      currentYear,
      latestStableYear: stableYear,
      excludedYears,
      corpusStartYear: records.length ? Math.min(...records.map((record) => record.year)) : null,
      corpusEndYear: records.length ? Math.max(...records.map((record) => record.year)) : null,
      comparisonMode: input.comparisonMode ?? "all",
      totalWorks: records.length,
      searchableWorks: input.works.length,
      publications: records.filter((record) => record.type !== "preprint").length,
      preprints: records.filter((record) => record.type === "preprint").length,
      journalCount: records.filter((record) => record.type === "journal").length,
      proceedingsCount: records.filter((record) => record.type === "proceedings").length,
      corpusComplete: input.corpusComplete,
      callsStatus: input.calls.status
    },
    publicationTrends,
    emergingSignals,
    agendaSignals,
    opportunities,
    warnings
  };
}
