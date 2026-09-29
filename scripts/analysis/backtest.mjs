// A deliberately simple prospective baseline: predict next 90-day counts using
// the previous 90 days. Only snapshots actually saved at the time may be used.
export function evaluateHistoricalForecasts(snapshots) {
  const ordered = snapshots.filter(s => s.researchEvaluation).sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const pairs = [];
  let lastBaseline = -Infinity;
  for (const earlier of ordered) {
    if (Date.parse(earlier.generatedAt) - lastBaseline < 90 * 86400000) continue;
    const a = earlier.researchEvaluation;
    if (!a.coverageComplete) continue;
    const later = ordered.find(s => {
      const days = (Date.parse(s.generatedAt) - Date.parse(earlier.generatedAt)) / 86400000;
      return days >= 90 && days <= 97 && s.researchEvaluation.coverageComplete && s.researchEvaluation.queryVersion === a.queryVersion && s.researchEvaluation.methodVersion === a.methodVersion;
    });
    if (!later) continue;
    lastBaseline = Date.parse(earlier.generatedAt);
    const b = later.researchEvaluation;
    for (const [theme, count] of Object.entries(a.themeCounts90)) {
      if (!Number.isInteger(b.themeCounts90[theme])) continue;
      pairs.push({ asOf: earlier.generatedAt, evaluatedAt: later.generatedAt, theme, predicted: count, observed: b.themeCounts90[theme], absoluteError: Math.abs(count - b.themeCounts90[theme]) });
    }
  }
  return { method: "persisted-as-of 90-day count persistence baseline; not a validated future trend model", independentPeriods: new Set(pairs.map(pair => pair.asOf)).size, evaluatedThemePairs: pairs.length, meanAbsoluteError: pairs.length ? pairs.reduce((sum, pair) => sum + pair.absoluteError, 0) / pairs.length : null, status: pairs.length ? "descriptive-baseline" : "insufficient-comparable-history", reason: "Requires two genuinely stored snapshots 90–97 days apart, unchanged query/method, complete retrieval coverage. No retrospective relabeling of old data.", pairs };
}
