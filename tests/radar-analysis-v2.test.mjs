import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { createTestD1 } from "./helpers/d1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const {
  classifyThemeEvidence,
  normalizeAnalysisText,
} = await vite.ssrLoadModule("/lib/radar/classification.ts");
const {
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY_VERSION,
} = await vite.ssrLoadModule("/lib/radar/config/themes.v2.ts");
const {
  buildResearchQuestions,
  buildThemeAnalysis,
  MINIMUM_DERIVED_QUESTION_EVIDENCE,
} = await vite.ssrLoadModule("/lib/radar/questions.ts");
const {
  createIngestionRun,
  ensureIngestionSource,
  finishIngestionRun,
  persistWork,
  readRadarData,
} = await vite.ssrLoadModule("/lib/radar/repository.ts");

after(async () => {
  await vite.close();
});

function classificationInput(overrides = {}) {
  return {
    title: "A neutral publication title",
    abstract: null,
    topics: [],
    keywords: [],
    ...overrides,
  };
}

function questionWork(id, themes) {
  return {
    id,
    title: `Evidence publication ${id}`,
    publicationDate: "2026-08-20",
    source: "Test Journal",
    sourceType: "journal",
    searchLayers: ["core"],
    authors: ["Researcher"],
    citedBy: 0,
    url: `https://example.org/${id}`,
    isOpenAccess: true,
    themes,
    themeClassifications: [],
    why: "Test",
    relevanceScore: 50,
  };
}

test("normalizes linguistic forms while enforcing word and phrase boundaries", () => {
  assert.equal(normalizeAnalysisText("Human–AI co-learning"), "human ai co learning");
  const boundaryResult = classifyThemeEvidence(classificationInput({
    title: "Distrust in entrusted autonomous systems",
  }));
  assert.equal(boundaryResult.some((item) => item.theme === "trust"), false);
  assert.deepEqual(classifyThemeEvidence(classificationInput({
    title: "Machine learning for image classification",
  })).map((item) => item.theme), []);
  const trusted = classifyThemeEvidence(classificationInput({ title: "Trusted automation support" }));
  assert.equal(trusted[0].theme, "trust");
  assert.ok(trusted[0].evidence.some((item) => item.matchedTerm === "trusted"));
});

test("classifies more than three themes and retains weighted source evidence", () => {
  const classifications = classifyThemeEvidence(classificationInput({
    title: "Trust, autonomy, cognitive load, human-AI collaboration, safety and motivation",
    abstract: "Worker agency shapes algorithmic management.",
    keywords: ["meaningful work"],
    topics: ["Work Design"],
  }));
  assert.ok(classifications.length > 3);
  assert.deepEqual(new Set(classifications.map((item) => item.theme)), new Set(["trust", "agency", "cognition", "teaming", "motivation", "safety"]));
  const agency = classifications.find((item) => item.theme === "agency");
  assert.ok(agency.score >= 10);
  assert.deepEqual(new Set(agency.evidence.map((item) => item.source)), new Set(["title", "abstract", "keyword", "openalex_topic"]));
  assert.equal(agency.classificationVersion, THEME_CLASSIFICATION_VERSION);
  assert.equal(agency.ontologyVersion, THEME_ONTOLOGY_VERSION);
});

test("persists classification version, score and triggering evidence", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const sourceId = await ensureIngestionSource(db, "core", "2026-08-28T10:00:00.000Z");
  const run = await createIngestionRun(db, {
    sourceId,
    scope: "ai",
    searchLayer: "core",
    queryVersion: "test-query",
    startedAt: "2026-08-28T10:00:00.000Z",
  });
  await persistWork(db, {
    provider: "openalex",
    doi: null,
    doiNormalized: null,
    openAlexId: "https://openalex.org/W-THEME-EVIDENCE",
    sourceRecordId: "https://openalex.org/W-THEME-EVIDENCE",
    normalizedTitle: "trust autonomy and cognitive load in human ai collaboration",
    title: "Trust, autonomy and cognitive load in human-AI collaboration",
    abstract: "Human oversight supports safety and worker agency.",
    authors: [{ id: null, name: "Researcher", orcid: null, position: "first" }],
    sourceExternalId: "S-TEST",
    sourceName: "Test Journal",
    sourceKind: "journal",
    sourceType: "journal",
    publicationDate: "2026-08-20",
    onlineDate: null,
    url: "https://example.org/theme-evidence",
    isOpenAccess: true,
    openAccessStatus: "gold",
    citedByCount: 0,
    topics: ["Work Design"],
    keywords: ["meaningful work", "trust calibration"],
    themes: [],
    retrievedAt: "2026-08-28T10:00:00.000Z",
  }, {
    ingestionRunId: run.id,
    scope: "ai",
    searchLayer: "core",
    queryVersion: "test-query",
  });

  const rows = db.raw.prepare(`
    SELECT theme, classification_version, ontology_version, score, evidence_json
    FROM work_themes ORDER BY score DESC
  `).all();
  assert.ok(rows.length > 3);
  assert.ok(rows.every((row) => row.classification_version === THEME_CLASSIFICATION_VERSION));
  assert.ok(rows.every((row) => row.ontology_version === THEME_ONTOLOGY_VERSION));
  assert.ok(rows.every((row) => row.score >= 2));
  assert.ok(rows.every((row) => JSON.parse(row.evidence_json).length > 0));

  await finishIngestionRun(db, {
    id: run.id,
    status: "succeeded",
    foundCount: 1,
    loadedCount: 1,
    newCount: 1,
    updatedCount: 0,
    errorCount: 0,
    endedAt: "2026-08-28T10:01:00.000Z",
  });
  const dashboard = await readRadarData(db, { days: 90, scope: "ai", layers: ["core"] });
  assert.equal(dashboard.works.length, 1);
  assert.ok(dashboard.works[0].themeClassifications.length > 3);
  assert.ok(dashboard.works[0].themeClassifications.every((item) => item.evidence.length > 0));
  assert.equal(dashboard.questions.dataDerived[0].status, "insufficient");
});

test("creates data-derived questions only with at least three concrete evidence records", () => {
  const works = [1, 2, 3, 4].map((id) => questionWork(String(id), ["trust", "agency"]));
  const questions = buildResearchQuestions(works);
  assert.ok(questions.lens.every((question) => question.kind === "lens"));
  assert.equal(questions.dataDerived[0].status, "supported");
  assert.equal(questions.dataDerived[0].count, 4);
  assert.ok(questions.dataDerived[0].evidence.length >= MINIMUM_DERIVED_QUESTION_EVIDENCE);
  assert.deepEqual(questions.dataDerived[0].evidence.slice(0, 3).map((item) => item.workId), ["1", "2", "3"]);
});

test("reports insufficient evidence instead of inventing a data-derived question", () => {
  const works = [questionWork("1", ["trust", "agency"]), questionWork("2", ["trust", "agency"])];
  const questions = buildResearchQuestions(works);
  assert.equal(questions.dataDerived.length, 1);
  assert.equal(questions.dataDerived[0].status, "insufficient");
  assert.equal(questions.dataDerived[0].count, 2);
  assert.equal(questions.dataDerived[0].evidence.length, 2);
  assert.match(questions.dataDerived[0].explanation, /mindestens 3/);

  const analysis = buildThemeAnalysis(works);
  assert.match(analysis.comparisonCaveat, /unterschiedlich breite.*Vokabulare/i);
  assert.ok(analysis.distribution.every((theme) => theme.configuredVocabularySize > 0));
});
