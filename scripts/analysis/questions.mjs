import { MINIMUM_EVIDENCE_RECORDS, QUESTION_METHOD_VERSION, THEMES, themeById } from "./ontology.v3.mjs";

const MAX_DERIVED_QUESTIONS = 4;
const MAX_EVIDENCE_RECORDS = 5;

export function buildLensQuestions() {
  return THEMES.map((theme) => ({
    id: `lens:${theme.id}`,
    kind: "lens",
    theme: theme.id,
    label: theme.label,
    question: theme.lensQuestion,
    rationale: theme.rationale,
    status: "framework",
    themes: [theme.id],
    evidence: []
  }));
}

function themePairs(works) {
  const pairs = new Map();
  for (const work of works) {
    const themes = [...new Set(work.classifiedThemes.map((theme) => theme.theme))].sort();
    for (let left = 0; left < themes.length; left += 1) {
      for (let right = left + 1; right < themes.length; right += 1) {
        const key = `${themes[left]}::${themes[right]}`;
        const current = pairs.get(key) ?? { themes: [themes[left], themes[right]], works: [] };
        current.works.push(work);
        pairs.set(key, current);
      }
    }
  }
  return [...pairs.values()].sort((left, right) => right.works.length - left.works.length || left.themes.join(":").localeCompare(right.themes.join(":")));
}

function evidenceReason(work, themes) {
  return themes.map((themeId) => {
    const classification = work.classifiedThemes.find((item) => item.theme === themeId);
    const terms = classification?.evidence.map((item) => item.matchedTerm).slice(0, 3).join(", ") || "keine Begriffe";
    return `${themeId}: ${terms}`;
  }).join("; ");
}

function derivedQuestion(pattern, status) {
  const [leftId, rightId] = pattern.themes;
  const left = themeById(leftId);
  const right = themeById(rightId);
  return {
    id: `derived:cooccurrence:${leftId}:${rightId}`,
    kind: "data-derived",
    pattern: "theme-cooccurrence",
    status,
    themes: [leftId, rightId],
    label: `${left?.shortLabel ?? leftId} × ${right?.shortLabel ?? rightId}`,
    question: status === "supported"
      ? `Wie wird die beobachtete Themenverbindung zwischen ${left?.shortLabel ?? leftId} und ${right?.shortLabel ?? rightId} in diesen Arbeiten untersucht?`
      : `Lässt sich eine belastbare Verbindung zwischen ${left?.shortLabel ?? leftId} und ${right?.shortLabel ?? rightId} formulieren?`,
    count: pattern.works.length,
    minimumEvidenceRecords: MINIMUM_EVIDENCE_RECORDS,
    evidence: pattern.works.slice(0, MAX_EVIDENCE_RECORDS).map((work) => ({
      workId: work.id,
      reason: evidenceReason(work, pattern.themes)
    }))
  };
}

export function buildQuestions(works) {
  const pairs = themePairs(works);
  const supported = pairs.filter((pair) => pair.works.length >= MINIMUM_EVIDENCE_RECORDS)
    .slice(0, MAX_DERIVED_QUESTIONS)
    .map((pair) => derivedQuestion(pair, "supported"));
  const dataDerived = supported.length
    ? supported
    : pairs.length
      ? [derivedQuestion(pairs[0], "insufficient")]
      : [{
        id: "derived:cooccurrence:insufficient",
        kind: "data-derived",
        pattern: "theme-cooccurrence",
        status: "insufficient",
        themes: [],
        label: "Keine belastbare Themenverbindung",
        question: "Welche wiederkehrende Verbindung zweier Themen lässt sich aus dem aktuellen Korpus ableiten?",
        count: 0,
        minimumEvidenceRecords: MINIMUM_EVIDENCE_RECORDS,
        evidence: []
      }];
  return {
    methodVersion: QUESTION_METHOD_VERSION,
    minimumEvidenceRecords: MINIMUM_EVIDENCE_RECORDS,
    lens: buildLensQuestions(),
    dataDerived
  };
}
