import {
  CLASSIFICATION_THRESHOLD, CLASSIFICATION_VERSION, FIELD_WEIGHTS, ONTOLOGY_VERSION, THEMES
} from "./ontology.v3.mjs";

export function normalizeAnalysisText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  const normalized = normalizeAnalysisText(value);
  return normalized ? normalized.split(" ") : [];
}

function sequenceAt(values, sequence, start) {
  return sequence.every((token, offset) => values[start + offset] === token);
}

function containsSequence(values, sequence) {
  if (!sequence.length || sequence.length > values.length) return false;
  for (let index = 0; index <= values.length - sequence.length; index += 1) {
    if (sequenceAt(values, sequence, index)) return true;
  }
  return false;
}

function removeExcluded(values, phrases = []) {
  const excluded = phrases.map(tokens).filter((phrase) => phrase.length);
  const retained = [];
  for (let index = 0; index < values.length;) {
    const match = excluded.find((phrase) => sequenceAt(values, phrase, index));
    if (match) index += match.length;
    else {
      retained.push(values[index]);
      index += 1;
    }
  }
  return retained;
}

function evidenceFor(theme, source, value) {
  const valueTokens = removeExcluded(tokens(value), theme.excludedPhrases);
  if (!valueTokens.length) return [];
  return theme.concepts.flatMap((concept) => {
    const matchedTerm = concept.terms.find((term) => containsSequence(valueTokens, tokens(term)));
    return matchedTerm ? [{
      source,
      concept: concept.id,
      conceptLabel: concept.label,
      matchedTerm,
      sourceValue: String(value).slice(Math.max(0, String(value).toLowerCase().indexOf(matchedTerm.toLowerCase()) - 80), Math.max(0, String(value).toLowerCase().indexOf(matchedTerm.toLowerCase()) - 80) + 320),
      weight: FIELD_WEIGHTS[source]
    }] : [];
  });
}

function uniqueEvidence(evidence) {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = `${item.source}:${item.concept}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyRecord(input) {
  return THEMES.flatMap((theme) => {
    const evidence = uniqueEvidence([
      ...evidenceFor(theme, "title", input.title),
      ...(input.abstract ? evidenceFor(theme, "abstract", input.abstract) : []),
      ...(input.keywords ?? []).flatMap((value) => evidenceFor(theme, "keyword", value)),
      ...(input.topics ?? []).flatMap((value) => evidenceFor(theme, "external_topic", value))
    ]);
    const score = evidence.reduce((sum, item) => sum + item.weight, 0);
    return score >= CLASSIFICATION_THRESHOLD ? [{
      theme: theme.id,
      label: theme.label,
      score,
      classificationVersion: CLASSIFICATION_VERSION,
      ontologyVersion: ONTOLOGY_VERSION,
      evidence
    }] : [];
  }).sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme));
}

export function classifyWork(work) {
  const classifiedThemes = classifyRecord(work);
  const matchedTerms = classifiedThemes.flatMap((classification) => classification.evidence.map((evidence) => evidence.matchedTerm));
  const scores = Object.fromEntries(Object.entries(work.scores ?? {}).filter(([key]) => key !== "classificationMaximum" && !key.startsWith("topic:")));
  for (const classification of classifiedThemes) scores[`topic:${classification.theme}`] = classification.score;
  scores.classificationMaximum = classifiedThemes.length ? Math.max(...classifiedThemes.map((classification) => classification.score)) : 0;
  return {
    ...work,
    classifiedThemes,
    scores,
    evidenceTerms: [...new Set([...(work.evidenceTerms ?? []), ...matchedTerms])]
  };
}
