// Shared by the static browser and Node pipelines. No platform dependencies.
export const RESEARCH_PROFILE = Object.freeze({
  id: "psychology-human-ai-1.0.0",
  label: "Psychologie & Human–AI Interaction",
  themes: ["learning", "agency", "cognition", "motivation", "trust", "teaming", "participation", "safety"]
});

export function callTimeStatus(call, now = Date.now(), verified = call.status !== "unverified", closingDays = 30) {
  const time = typeof now === "number" ? now : new Date(now).getTime();
  const deadline = Date.parse(call.deadlineAt);
  if (Number.isFinite(deadline) && deadline < time) return "expired";
  if (!verified || !Number.isFinite(deadline)) return "unverified";
  return deadline - time <= closingDays * 86400000 ? "closing-soon" : "open";
}

export function deadlineLabel(call) {
  if (!call.deadlineAt) return "Keine datierte Deadline";
  // Preserve the date/time written in the source's offset, never label local time AoE.
  const [date, time] = call.deadlineAt.split("T");
  return `${date} · ${time.slice(0, 5)} ${call.deadlineTimezone || time.slice(8) || "UTC"}`;
}

export function freshness(timestamp, now = Date.now(), maximumDays = 8) {
  const age = (Number(now) - Date.parse(timestamp)) / 86400000;
  return !Number.isFinite(age) ? "unavailable" : age > maximumDays ? "stale" : "current";
}

export function weekWindow(timestamp) {
  const start = new Date(timestamp);
  if (!Number.isFinite(start.getTime())) return null;
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return { start: start.getTime(), end: start.getTime() + 7 * 86400000 };
}

export function matchesNovelty(work, mode, { previousVisit, latestRunId, latestRunAt, now = Date.now() } = {}) {
  const first = Date.parse(work.firstSeenAt);
  if (mode === "since-visit") return Boolean(previousVisit) && first > Date.parse(previousVisit);
  if (mode === "latest-run") return Boolean(latestRunId) && work.firstSeenRunId === latestRunId;
  if (mode === "week") {
    const week = weekWindow(latestRunAt);
    return Boolean(week) && first >= week.start && first < week.end;
  }
  if (mode === "published-30") {
    const published = Date.parse(work.publicationDate);
    return published <= Number(now) && published >= Number(now) - 30 * 86400000;
  }
  return true;
}

export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function auditCsv(works) {
  const fields = ["id", "title", "abstract", "doi", "url", "source_modes", "predicted_themes", "manual_label", "manual_themes", "work_context", "population", "study_design", "outcomes", "manual_note", "retrieved", "review_status", "reviewer"];
  return [fields, ...works.map(w => [w.id, w.title, w.abstract, w.doi, w.url,
    (w.discoveredBy ?? []).map(d => d.mode).join(";"), (w.classifiedThemes ?? []).map(t => t.theme).join(";"),
    "", "", "", "", "", "", "", "true", "", ""])].map(row => row.map(csvCell).join(",")).join("\r\n");
}
