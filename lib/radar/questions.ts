import type {
  RadarDerivedQuestion,
  RadarLensQuestion,
  RadarQuestions,
  RadarThemeAnalysis,
  RadarWork,
} from "@/app/radar-types";
import { ANALYSIS_VERSION } from "./config";
import {
  configuredVocabularySize,
  findThemeDefinition,
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY,
  THEME_ONTOLOGY_VERSION,
  THEME_SCORE_THRESHOLD,
  THEME_SCORE_WEIGHTS,
} from "./config/themes.v2";

export const MINIMUM_DERIVED_QUESTION_EVIDENCE = 3;
const MAX_DERIVED_QUESTIONS = 4;
const MAX_EVIDENCE_RECORDS = 5;

export function buildLensQuestions(): RadarLensQuestion[] {
  return THEME_ONTOLOGY.map((theme) => ({
    id: `lens:${theme.id}`,
    kind: "lens",
    theme: theme.id,
    label: theme.label,
    question: theme.lensQuestion,
    rationale: theme.why,
  }));
}

type PairPattern = {
  themes: [string, string];
  works: RadarWork[];
};

function themePairs(works: RadarWork[]) {
  const pairs = new Map<string, PairPattern>();
  for (const work of works) {
    const themes = [...new Set(work.themes)].sort();
    for (let left = 0; left < themes.length; left += 1) {
      for (let right = left + 1; right < themes.length; right += 1) {
        const key = `${themes[left]}::${themes[right]}`;
        const current = pairs.get(key) ?? { themes: [themes[left], themes[right]], works: [] };
        current.works.push(work);
        pairs.set(key, current);
      }
    }
  }
  return [...pairs.values()].sort((left, right) =>
    right.works.length - left.works.length || left.themes.join(":").localeCompare(right.themes.join(":")));
}

function pairQuestion(pattern: PairPattern, status: RadarDerivedQuestion["status"]): RadarDerivedQuestion {
  const [leftId, rightId] = pattern.themes;
  const left = findThemeDefinition(leftId);
  const right = findThemeDefinition(rightId);
  const leftLabel = left?.short ?? leftId;
  const rightLabel = right?.short ?? rightId;
  const evidence = pattern.works.slice(0, MAX_EVIDENCE_RECORDS).map((work) => ({
    workId: work.id,
    title: work.title,
    url: work.url,
  }));
  const supported = status === "supported";
  return {
    id: `derived:theme-cooccurrence:${leftId}:${rightId}`,
    kind: "data-derived",
    pattern: "theme_cooccurrence",
    status,
    themes: [leftId, rightId],
    label: `${leftLabel} × ${rightLabel}`,
    question: supported
      ? `Welche Mechanismen erklären, wann ${leftLabel} und ${rightLabel} in der Mensch–KI-Forschung gemeinsam auftreten?`
      : `Lässt sich eine belastbare Verbindung zwischen ${leftLabel} und ${rightLabel} formulieren?`,
    explanation: supported
      ? `${pattern.works.length} analysierte Publikationen wurden beiden Themen zugeordnet. Die Frage beschreibt diese Ko-Okkurrenz, nicht automatisch einen kausalen Zusammenhang.`
      : `Nur ${pattern.works.length} analysierte Publikation${pattern.works.length === 1 ? "" : "en"} verbindet diese Themen. Für eine datenabgeleitete Frage sind mindestens ${MINIMUM_DERIVED_QUESTION_EVIDENCE} konkrete Evidenzdatensätze erforderlich.`,
    count: pattern.works.length,
    minimumEvidenceRecords: MINIMUM_DERIVED_QUESTION_EVIDENCE,
    evidence,
  };
}

function insufficientQuestion(works: RadarWork[], bestPattern?: PairPattern): RadarDerivedQuestion {
  if (bestPattern) return pairQuestion(bestPattern, "insufficient");
  return {
    id: "derived:theme-cooccurrence:insufficient",
    kind: "data-derived",
    pattern: "theme_cooccurrence",
    status: "insufficient",
    themes: [],
    label: "Zu wenig Evidenz für Konstruktverbindungen",
    question: "Welche wiederkehrende Verbindung zweier Themen lässt sich aus dem aktuellen Datensatz ableiten?",
    explanation: `Im aktuellen Ausschnitt gibt es keine Themenverbindung mit mindestens ${MINIMUM_DERIVED_QUESTION_EVIDENCE} konkreten Publikationen. Es wird deshalb keine inhaltliche Verbindung behauptet.`,
    count: 0,
    minimumEvidenceRecords: MINIMUM_DERIVED_QUESTION_EVIDENCE,
    evidence: works.slice(0, Math.min(works.length, MINIMUM_DERIVED_QUESTION_EVIDENCE - 1)).map((work) => ({
      workId: work.id,
      title: work.title,
      url: work.url,
    })),
  };
}

export function buildResearchQuestions(works: RadarWork[]): RadarQuestions {
  const pairs = themePairs(works);
  const supported = pairs
    .filter((pattern) => pattern.works.length >= MINIMUM_DERIVED_QUESTION_EVIDENCE)
    .slice(0, MAX_DERIVED_QUESTIONS)
    .map((pattern) => pairQuestion(pattern, "supported"));
  return {
    analysisVersion: ANALYSIS_VERSION,
    minimumEvidenceRecords: MINIMUM_DERIVED_QUESTION_EVIDENCE,
    lens: buildLensQuestions(),
    dataDerived: supported.length > 0 ? supported : [insufficientQuestion(works, pairs[0])],
  };
}

export function buildThemeAnalysis(works: RadarWork[]): RadarThemeAnalysis {
  return {
    ontologyVersion: THEME_ONTOLOGY_VERSION,
    classificationVersion: THEME_CLASSIFICATION_VERSION,
    scoreThreshold: THEME_SCORE_THRESHOLD,
    weights: { ...THEME_SCORE_WEIGHTS },
    distribution: THEME_ONTOLOGY.map((theme) => {
      const count = works.filter((work) => work.themes.includes(theme.id)).length;
      return {
        theme: theme.id,
        label: theme.label,
        count,
        share: works.length > 0 ? Math.round((count / works.length) * 100) : 0,
        configuredVocabularySize: configuredVocabularySize(theme),
      };
    }),
    comparisonCaveat: "Die Werte sind rohe Zuordnungshäufigkeiten. Themen besitzen unterschiedlich breite konfigurierte Vokabulare; Counts, Anteile und Klassifikationsscores dürfen deshalb nicht unkritisch als direkte Stärkevergleiche gelesen werden.",
  };
}
