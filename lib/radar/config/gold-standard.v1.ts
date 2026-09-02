export const GOLD_STANDARD_VERSION = "gold-standard-1.0.0";

export type GoldStandardLabel = "relevant" | "irrelevant" | "unclear";

export type GoldStandardRecord = {
  id: string;
  title: string;
  expectedRelevance: GoldStandardLabel;
  retrieved: boolean;
  reviewStatus: "manually_verified";
};

// This stays empty until researchers have manually reviewed real records.
// Never add generated, inferred or example labels here.
export const GOLD_STANDARD_RECORDS: readonly GoldStandardRecord[] = [];

export function computeRetrievalMetrics(records: readonly GoldStandardRecord[]) {
  const verified = records.filter((record) => record.reviewStatus === "manually_verified");
  const retrievedAndDecidable = verified.filter((record) => record.retrieved && record.expectedRelevance !== "unclear");
  const relevant = verified.filter((record) => record.expectedRelevance === "relevant");
  if (verified.length === 0) {
    return {
      status: "not_available" as const,
      manuallyLabeledCount: 0,
      precision: null,
      recall: null,
      reason: "Es liegen noch keine manuell verifizierten Goldstandard-Labels vor.",
    };
  }
  const truePositives = relevant.filter((record) => record.retrieved).length;
  const precision = retrievedAndDecidable.length > 0 ? truePositives / retrievedAndDecidable.length : null;
  const recall = relevant.length > 0 ? truePositives / relevant.length : null;
  return {
    status: precision !== null && recall !== null ? "available" as const : "partial" as const,
    manuallyLabeledCount: verified.length,
    precision,
    recall,
    reason: precision !== null && recall !== null
      ? null
      : "Die vorhandenen manuellen Labels reichen noch nicht für beide Kennzahlen aus.",
  };
}
