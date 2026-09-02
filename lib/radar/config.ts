import type { DataStatus, RadarWork } from "@/app/radar-types";
import { findThemeDefinition } from "./config/themes.v2";

export * from "./config/search.v3";
export * from "./config/sources.v3";
export * from "./config/themes.v2";
export * from "./config/trend-analysis.v1";
export { classifyThemeEvidence, classifyThemes, normalizeAnalysisText } from "./classification";

export const ANALYSIS_VERSION = "rule-based-2.0.0";
export const CACHE_DURATION_SECONDS = 21_600;
export const STALE_WHILE_REVALIDATE_SECONDS = 86_400;

export function normalizeTitle(title: string) {
  return title.toLocaleLowerCase("en").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeDoi(value?: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return normalized || null;
}

export function relevanceFor(themes: string[], citedBy: number) {
  const themeBoost = themes.reduce((score, theme) => score + (["learning", "agency", "motivation"].includes(theme) ? 16 : ["cognition", "teaming"].includes(theme) ? 13 : 9), 0);
  return Math.min(99, 48 + themeBoost + Math.min(12, Math.round(Math.log2(citedBy + 1) * 2)));
}

export function buildRadarWork(input: Omit<RadarWork, "why" | "relevanceScore">): RadarWork {
  const primaryClassification = input.themeClassifications[0];
  const primaryTheme = primaryClassification ? findThemeDefinition(primaryClassification.theme) : null;
  const evidenceTerms = primaryClassification
    ? [...new Set(primaryClassification.evidence.map((item) => item.matchedTerm))].slice(0, 4)
    : [];
  return {
    ...input,
    why: primaryTheme
      ? `${primaryTheme.why}${evidenceTerms.length ? ` Auslösende Begriffe: ${evidenceTerms.join(", ")}.` : ""}`
      : "Keine Themenzuordnung oberhalb des dokumentierten Schwellenwerts.",
    relevanceScore: relevanceFor(input.themes, input.citedBy),
  };
}

export function overallStatus(statuses: DataStatus[]): DataStatus {
  if (statuses.every((status) => status === "live")) return "live";
  if (statuses.every((status) => status === "unavailable")) return "unavailable";
  return "partial";
}
