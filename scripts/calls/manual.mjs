import { callRecord } from "./adapters/shared.mjs";
import { OFFICIAL_CALL_SOURCES } from "./config.mjs";

export function manualCandidates(data, generatedAt) {
  if (data.schemaVersion !== "manual-calls-1.0.0" || !Array.isArray(data.items)) throw new Error("Invalid manual calls registry");
  return data.items.map(entry => {
    const source = OFFICIAL_CALL_SOURCES.find(source => source.key === entry.sourceKey);
    const checked = Date.parse(entry.checkedAt), age = Date.parse(generatedAt) - checked;
    if (!source || !entry.reviewer?.trim() || !Number.isFinite(checked) || age < 0 || typeof entry.deadlineQuote !== "string" || entry.deadlineQuote.length < 10 || !entry.deadlineAt || !Number.isFinite(Date.parse(entry.deadlineAt))) throw new Error("Manual call requires source, reviewer, checkedAt, exact deadline quote and deadline");
    const call = callRecord(source, entry);
    return { ...call, parserVersion: source.parserVersion, sourceVersion: source.sourceVersion, sourceKey: source.key, sourceName: source.name,
      verificationEvidence: { method: "human-reviewed", checkedAt: entry.checkedAt, reviewer: entry.reviewer, sourceUrl: call.officialUrl, deadlineQuote: entry.deadlineQuote, fresh: age <= 8 * 86400000 } };
  });
}
