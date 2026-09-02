import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const {
  buildTrendAnalysis,
  detectEqualWindowChangePoint,
  latestStableCompleteYear,
} = await vite.ssrLoadModule("/lib/radar/trend-analysis.ts");

after(async () => {
  await vite.close();
});

let recordSequence = 0;

function recordsForYear(year, count, options = {}) {
  const { preprints = 0, theme = "trust", providers = ["openalex"], venues = ["Test Journal"] } = options;
  return Array.from({ length: count }, (_, index) => ({
    id: `record-${year}-${recordSequence++}`,
    year,
    type: index < preprints ? "preprint" : "journal",
    venue: venues[index % venues.length],
    providers: [providers[index % providers.length]],
    themes: [theme],
  }));
}

function comparison(startYear = 2018, endYear = 2026) {
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => ({
    year: startYear + index,
    article: 1_000,
    preprint: 0,
  }));
}

function analyze(records, overrides = {}) {
  return buildTrendAnalysis({
    records,
    comparison: comparison(),
    agenda: [],
    scope: "ai",
    capturedAt: "2026-08-28T12:00:00.000Z",
    corpusComplete: true,
    denominatorComplete: true,
    callsAvailable: true,
    ...overrides,
  });
}

function theme(result, id = "trust") {
  return result.themes.find((signal) => signal.theme === id);
}

test("separates the running year and applies the documented indexing reserve", () => {
  assert.equal(latestStableCompleteYear("2026-02-01T12:00:00.000Z"), 2024);
  assert.equal(latestStableCompleteYear("2026-08-28T12:00:00.000Z"), 2025);

  const result = analyze([
    ...recordsForYear(2024, 8),
    ...recordsForYear(2025, 12),
    ...recordsForYear(2026, 50),
  ]);
  const signal = theme(result);
  assert.equal(signal.stableEndYear, 2025);
  assert.deepEqual(signal.currentYear, { year: 2026, count: 50, partial: true, includedInComparisons: false });
  assert.equal(signal.windows.shortRecent.absoluteCount, 20);
  assert.equal(signal.annual.find((point) => point.year === 2026).excludedFromComparisons, true);
});

test("computes equal-window counts, normalized rates, growth, acceleration and diversity", () => {
  const records = [
    ...recordsForYear(2018, 5),
    ...recordsForYear(2019, 5),
    ...recordsForYear(2020, 5),
    ...recordsForYear(2021, 5),
    ...recordsForYear(2022, 5),
    ...recordsForYear(2023, 5),
    ...recordsForYear(2024, 8, { preprints: 2, providers: ["openalex", "arxiv"], venues: ["Journal A", "Repository B"] }),
    ...recordsForYear(2025, 12, { preprints: 3, providers: ["openalex", "arxiv"], venues: ["Journal A", "Repository B"] }),
    ...recordsForYear(2026, 40),
  ];
  const signal = theme(analyze(records));

  assert.deepEqual(
    [signal.windows.shortPrevious.startYear, signal.windows.shortPrevious.endYear, signal.windows.shortRecent.startYear, signal.windows.shortRecent.endYear],
    [2022, 2023, 2024, 2025],
  );
  assert.equal(signal.windows.shortRecent.yearCount, signal.windows.shortPrevious.yearCount);
  assert.equal(signal.windows.shortRecent.absoluteCount, 20);
  assert.equal(signal.windows.shortRecent.perThousand, 10);
  assert.equal(signal.windows.shortRecent.journalShare, 75);
  assert.equal(signal.windows.shortRecent.preprintShare, 25);
  assert.equal(signal.shortGrowthPercent, 100);
  assert.equal(signal.longGrowthPercent, 50);
  assert.equal(signal.accelerationPercentagePoints, 100);
  assert.equal(signal.acceleration, "accelerating");
  assert.deepEqual([signal.diversity.sourceCount, signal.diversity.venueCount], [2, 2]);
  assert.equal(signal.diversity.venueDiversityPercent, 100);
});

test("withholds trend and opportunity claims below the minimum sample", () => {
  const records = [
    ...recordsForYear(2018, 2),
    ...recordsForYear(2019, 2),
    ...recordsForYear(2020, 2),
    ...recordsForYear(2021, 2),
    ...recordsForYear(2022, 2),
    ...recordsForYear(2023, 2),
    ...recordsForYear(2024, 2),
    ...recordsForYear(2025, 2),
  ];
  const signal = theme(analyze(records));

  assert.equal(signal.dataQuality.status, "insufficient");
  assert.equal(signal.observedTrend.status, "insufficient");
  assert.equal(signal.emergingSignal.status, "insufficient");
  assert.equal(signal.changePoint.direction, "insufficient");
  assert.equal(signal.shortGrowthPercent, null);
  assert.equal(signal.opportunity.score, null);
  assert.match(signal.opportunity.interpretation, /kein Opportunity Score/i);
});

test("detects only sufficiently large changes between equal windows", () => {
  assert.deepEqual(detectEqualWindowChangePoint(4, 20), {
    detected: false,
    direction: "insufficient",
    zScore: null,
    threshold: 1.96,
  });
  assert.deepEqual(detectEqualWindowChangePoint(8, 6), {
    detected: false,
    direction: "none",
    zScore: 0.53,
    threshold: 1.96,
  });
  assert.deepEqual(detectEqualWindowChangePoint(40, 10), {
    detected: true,
    direction: "up",
    zScore: 4.24,
    threshold: 1.96,
  });
});

test("keeps agenda, emerging, observed trend and opportunity components separate", () => {
  const records = [
    ...recordsForYear(2018, 5),
    ...recordsForYear(2019, 5),
    ...recordsForYear(2020, 5),
    ...recordsForYear(2021, 5),
    ...recordsForYear(2022, 5),
    ...recordsForYear(2023, 5),
    ...recordsForYear(2024, 2, { preprints: 2 }),
    ...recordsForYear(2025, 3, { preprints: 3 }),
  ];
  const signal = theme(analyze(records, {
    agenda: [{ theme: "trust", activeCalls: 3, closingCalls: 2 }],
  }));

  assert.equal(signal.observedTrend.status, "declining");
  assert.equal(signal.agendaSignal.status, "strong");
  assert.equal(signal.emergingSignal.status, "rising");
  assert.equal(signal.opportunity.components.length, 4);
  assert.equal(
    signal.opportunity.score,
    Math.round(signal.opportunity.components.reduce((sum, component) => sum + component.score, 0)),
  );
  assert.equal(signal.opportunity.status, "mixed");
  assert.ok(signal.contradictions.some((item) => item.includes("Calls-Signal")));
});
