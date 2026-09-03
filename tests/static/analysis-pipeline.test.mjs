import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyRecord, normalizeAnalysisText } from "../../scripts/analysis/classification.mjs";
import { buildStaticMetrics, latestStableYear } from "../../scripts/analysis/metrics.mjs";
import { runAnalysisPipeline } from "../../scripts/analysis/pipeline.mjs";
import { buildQuestions } from "../../scripts/analysis/questions.mjs";
import { validateDataDirectory } from "../../scripts/validate-data.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");

function work(id, year, themes = [], options = {}) {
  const type = options.type ?? "journal";
  return {
    id,
    recordType: type === "preprint" ? "preprint" : "publication",
    title: options.title ?? "Controlled record",
    abstract: options.abstract ?? "Controlled abstract",
    publicationDate: `${year}-06-15`,
    venue: options.venue ?? (Number(id.match(/\d+/)?.[0] ?? 0) % 2 ? "Venue A" : "Venue B"),
    topics: [],
    keywords: [],
    classifiedThemes: themes.map((theme) => ({ theme, evidence: [{ matchedTerm: theme }] })),
    citedByCount: 0,
    preferredVersionId: `${id}:version`,
    versions: [{ id: `${id}:version`, type }],
    source: { name: options.source ?? "OpenAlex" },
    discoveredBy: [{ provider: "openalex" }]
  };
}

function controlledSeries() {
  const output = [];
  const trustCounts = new Map([[2018, 5], [2019, 5], [2020, 5], [2021, 5], [2022, 5], [2023, 5], [2024, 8], [2025, 12]]);
  for (const [year, count] of trustCounts) {
    for (let index = 0; index < 20; index += 1) {
      output.push(work(`work-${year}-${index}`, year, index < count ? ["trust"] : [], {
        type: year >= 2024 && index < count && index % 4 === 0 ? "preprint" : "journal",
        venue: index % 2 ? "Venue A" : "Venue B"
      }));
    }
  }
  output.push(work("running-year-record", 2026, ["trust"], { type: "preprint" }));
  return output;
}

function calls() {
  return {
    status: "partial",
    items: [
      { id: "call-1", title: "Trust in AI", description: "Trust calibration", topics: ["trust"], status: "open", deadlineAt: "2027-01-10T23:59:00Z", sourceKey: "source-a" },
      { id: "call-2", title: "Calibrated reliance", description: "Appropriate reliance", topics: ["trust"], status: "closing-soon", deadlineAt: "2026-10-01T23:59:00Z", sourceKey: "source-b" },
      { id: "call-3", title: "Trustworthy interaction", description: "Trust in automation", topics: ["trust"], status: "closing-soon", deadlineAt: "2026-10-15T23:59:00Z", sourceKey: "source-c" }
    ]
  };
}

test("Normalisierung und Wortgrenzen vermeiden Teilwort- und Machine-Learning-Fehlklassifikationen", () => {
  assert.equal(normalizeAnalysisText("Worker’s TRUST-calibration"), "workers trust calibration");
  assert.equal(classifyRecord({ title: "Distrust in automation", abstract: null, keywords: [], topics: [] }).some((entry) => entry.theme === "trust"), false);
  assert.equal(classifyRecord({ title: "Machine learning benchmark", abstract: null, keywords: [], topics: [] }).some((entry) => entry.theme === "learning"), false);
  const classified = classifyRecord({ title: "Human learning and calibrated trust", abstract: null, keywords: [], topics: [] });
  assert.deepEqual(classified.map((entry) => entry.theme).sort(), ["learning", "trust"]);
  assert.ok(classified.every((entry) => entry.evidence.every((evidence) => ["title", "abstract", "keyword", "external_topic"].includes(evidence.source))));
  const allFields = classifyRecord({
    title: "Controlled study",
    abstract: "Trust and reliance in automation",
    keywords: ["job autonomy"],
    topics: ["Occupational safety"]
  });
  assert.deepEqual(allFields.map((entry) => entry.theme).sort(), ["agency", "safety", "trust"]);
  assert.deepEqual([...new Set(allFields.flatMap((entry) => entry.evidence.map((evidence) => evidence.source)))].sort(), ["abstract", "external_topic", "keyword"]);
});

test("kontrollierte Zeitreihe berechnet gleiche Fenster, Raten, Wachstum und Beschleunigung", () => {
  assert.equal(latestStableYear(new Date("2026-09-02T12:00:00Z")), 2025);
  const result = buildStaticMetrics({ generatedAt: "2026-09-02T12:00:00Z", works: controlledSeries(), calls: calls(), corpusComplete: true });
  const trust = result.publicationTrends.find((entry) => entry.theme === "trust");
  assert.equal(trust.windows.shortRecent.startYear, 2024);
  assert.equal(trust.windows.shortRecent.endYear, 2025);
  assert.equal(trust.windows.shortRecent.absoluteCount, 20);
  assert.equal(trust.windows.shortRecent.eligibleCorpusCount, 40);
  assert.equal(trust.windows.shortRecent.normalizedRatePer1000, 500);
  assert.equal(trust.growth.short.absolutePercent, 100);
  assert.equal(trust.growth.short.normalizedPercent, 100);
  assert.equal(trust.growth.long.normalizedPercent, 50);
  assert.equal(trust.accelerationPercentagePoints, 100);
  assert.equal(trust.annual.find((entry) => entry.year === 2026).excludedFromComparisons, true);
  assert.equal(result.emergingSignals.find((entry) => entry.theme === "trust").status, "emerging");
  assert.equal(result.agendaSignals.find((entry) => entry.theme === "trust").status, "strong");
  const opportunity = result.opportunities.find((entry) => entry.theme === "trust");
  assert.equal(opportunity.components.length, 4);
  assert.equal(typeof opportunity.score, "number");
  assert.equal(opportunity.uncertainty.level, "medium");
});

test("laufendes Jahr allein erzeugt keine Wachstumswerte oder Opportunity-Prognose", () => {
  const result = buildStaticMetrics({ generatedAt: "2026-09-02T12:00:00Z", works: [work("current", 2026, ["trust"])], calls: { status: "unavailable", items: [] }, corpusComplete: false });
  const trust = result.publicationTrends.find((entry) => entry.theme === "trust");
  assert.equal(trust.growth.short.normalizedPercent, null);
  assert.equal(trust.growth.long.normalizedPercent, null);
  assert.equal(trust.accelerationPercentagePoints, null);
  assert.equal(result.emergingSignals.find((entry) => entry.theme === "trust").status, "insufficient");
  assert.equal(result.opportunities.find((entry) => entry.theme === "trust").score, null);
  assert.ok(result.warnings.some((warning) => warning.code === "no-stable-year-records"));
});

test("datenabgeleitete Fragen benötigen mindestens drei verknüpfte Evidenzarbeiten", () => {
  const works = [1, 2, 3].map((index) => work(`pair-${index}`, 2025, ["trust", "agency"]));
  const result = buildQuestions(works);
  assert.equal(result.lens.length, 8);
  const question = result.dataDerived.find((entry) => entry.themes.includes("trust") && entry.themes.includes("agency"));
  assert.equal(question.status, "supported");
  assert.equal(question.count, 3);
  assert.equal(question.evidence.length, 3);
});

test("Pipeline klassifiziert Fixtures, schreibt einen Snapshot und bleibt vollständig validierbar", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "radar-analysis-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(path.join(projectRoot, "tests/fixtures/static-data/valid"), temporaryRoot, { recursive: true });

  const result = await runAnalysisPipeline({ dataDirectory: temporaryRoot, generatedAt: "2026-09-02T14:00:00Z" });
  assert.equal(result.totalWorks, 1);
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
  const trends = JSON.parse(await readFile(path.join(temporaryRoot, "trends.json"), "utf8"));
  assert.deepEqual(Object.keys(trends).filter((key) => ["publicationTrends", "emergingSignals", "agendaSignals", "opportunities"].includes(key)).sort(), ["agendaSignals", "emergingSignals", "opportunities", "publicationTrends"]);
  assert.equal(trends.opportunities.every((entry) => entry.score === null), true);
  const validation = await validateDataDirectory(temporaryRoot);
  assert.equal(validation.valid, true, validation.errors.map((error) => JSON.stringify(error)).join("\n"));
});
