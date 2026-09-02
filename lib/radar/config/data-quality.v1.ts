export const DATA_QUALITY_VERSION = "data-quality-1.0.0";

export const DATA_QUALITY_THRESHOLDS = {
  sourceDeclinePercent: 50,
  duplicateSharePercent: 75,
  missingAbstractSharePercent: 30,
  staleRunHours: 24 * 8,
} as const;

export const DATA_QUALITY_CHECKS = [
  "unexpected_zero_hits",
  "source_decline",
  "high_duplicate_share",
  "missing_abstracts",
  "stale_ingestion_run",
  "source_partial",
  "source_unavailable",
] as const;

export type DataQualityCheckKey = (typeof DATA_QUALITY_CHECKS)[number];
