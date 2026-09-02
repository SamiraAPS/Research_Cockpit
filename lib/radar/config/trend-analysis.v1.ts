export const TREND_ANALYSIS_VERSION = "trend-opportunity-1.0.0";
export const TREND_SNAPSHOT_VERSION = "theme-signal-snapshot-1.0.0";

export const SHORT_TREND_WINDOW_YEARS = 2;
export const LONG_TREND_WINDOW_YEARS = 4;
export const INDEXING_LAG_DAYS = 120;
export const MINIMUM_TREND_PUBLICATIONS = 5;
export const CHANGE_POINT_Z_THRESHOLD = 1.96;
export const GROWTH_SIGNAL_THRESHOLD_PERCENT = 15;

export const OPPORTUNITY_COMPONENT_MAX = 25;

export const STRATEGIC_FIT: Record<string, { score: number; rationale: string }> = {
  learning: { score: 24, rationale: "Hohe Passung zu Lernen, Expertiseerhalt und High-Skill Operations." },
  trust: { score: 22, rationale: "Hohe Passung zu Human Factors und angemessener Reliance." },
  agency: { score: 25, rationale: "Sehr hohe Passung zu Work Design, Autonomie und sinnvoller Arbeit." },
  cognition: { score: 25, rationale: "Sehr hohe Passung zu Human Factors und kognitiv anspruchsvollen Operationen." },
  teaming: { score: 24, rationale: "Hohe Passung zu Human–AI-Zusammenarbeit und High-Skill Operations." },
  motivation: { score: 20, rationale: "Direkte Passung zu Arbeitspsychologie, Engagement und Wohlbefinden." },
  safety: { score: 25, rationale: "Sehr hohe Passung zu Human Factors, Aufsicht und sicherheitskritischen Operationen." },
  participation: { score: 19, rationale: "Relevante Passung zu soziotechnischer Gestaltung, Fairness und Governance." },
};

export const TREND_COMPARISON_FIELD_LABELS = {
  ai: "Psychologie × KI mit Human-/Work-Begriffen",
  field: "Psychologie × Human Factors, Arbeit und Organisation",
} as const;
