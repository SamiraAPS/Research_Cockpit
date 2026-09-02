import {
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY,
  THEME_ONTOLOGY_VERSION,
  THEME_SCORE_THRESHOLD,
  THEME_SCORE_WEIGHTS,
  type ThemeDefinition,
  type ThemeEvidenceSource,
} from "./config/themes.v2";

export type ThemeClassificationEvidence = {
  source: ThemeEvidenceSource;
  concept: string;
  conceptLabel: string;
  matchedTerm: string;
  sourceValue: string;
  weight: number;
};

export type ThemeClassification = {
  theme: string;
  label: string;
  score: number;
  classificationVersion: string;
  ontologyVersion: string;
  evidence: ThemeClassificationEvidence[];
};

export type ThemeClassificationInput = {
  title: string;
  abstract: string | null;
  topics: string[];
  keywords: string[];
};

export function normalizeAnalysisText(value: string) {
  return value
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  const normalized = normalizeAnalysisText(value);
  return normalized ? normalized.split(" ") : [];
}

function sequenceAt(values: string[], sequence: string[], start: number) {
  return sequence.every((token, offset) => values[start + offset] === token);
}

function removeExcludedPhrases(values: string[], phrases: readonly string[] | undefined) {
  if (!phrases?.length) return values;
  const excluded = phrases.map(tokens).filter((phrase) => phrase.length > 0);
  const retained: string[] = [];
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

function containsSequence(values: string[], sequence: string[]) {
  if (sequence.length === 0 || sequence.length > values.length) return false;
  for (let index = 0; index <= values.length - sequence.length; index += 1) {
    if (sequenceAt(values, sequence, index)) return true;
  }
  return false;
}

function evidenceForValue(
  theme: ThemeDefinition,
  source: ThemeEvidenceSource,
  value: string,
): ThemeClassificationEvidence[] {
  const valueTokens = removeExcludedPhrases(tokens(value), theme.excludedPhrases);
  if (valueTokens.length === 0) return [];
  return theme.concepts.flatMap((concept) => {
    const matchedTerm = concept.variants.find((variant) => containsSequence(valueTokens, tokens(variant)));
    return matchedTerm ? [{
      source,
      concept: concept.id,
      conceptLabel: concept.label,
      matchedTerm,
      sourceValue: value.slice(0, 240),
      weight: THEME_SCORE_WEIGHTS[source],
    }] : [];
  });
}

function uniqueEvidence(evidence: ThemeClassificationEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.source}:${item.concept}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyThemeEvidence(input: ThemeClassificationInput): ThemeClassification[] {
  return THEME_ONTOLOGY.flatMap((theme) => {
    const evidence = uniqueEvidence([
      ...evidenceForValue(theme, "title", input.title),
      ...(input.abstract ? evidenceForValue(theme, "abstract", input.abstract) : []),
      ...input.keywords.flatMap((keyword) => evidenceForValue(theme, "keyword", keyword)),
      ...input.topics.flatMap((topic) => evidenceForValue(theme, "openalex_topic", topic)),
    ]);
    const score = evidence.reduce((sum, item) => sum + item.weight, 0);
    return score >= THEME_SCORE_THRESHOLD ? [{
      theme: theme.id,
      label: theme.label,
      score,
      classificationVersion: THEME_CLASSIFICATION_VERSION,
      ontologyVersion: THEME_ONTOLOGY_VERSION,
      evidence,
    }] : [];
  }).sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme));
}

export function classifyThemes(title: string, abstract: string | null, topics: string[], keywords: string[]) {
  return classifyThemeEvidence({ title, abstract, topics, keywords }).map((classification) => classification.theme);
}
