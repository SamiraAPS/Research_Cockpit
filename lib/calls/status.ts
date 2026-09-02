import type { CallStatus } from "./types";

export const CALL_CLOSING_WINDOW_DAYS = 30;

function dateOnly(value: Date | string) {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

export function calculateCallStatus(deadline: string | null, verified: boolean, now: Date | string = new Date()): CallStatus {
  if (!verified || !deadline) return "unverified";
  const today = dateOnly(now);
  if (deadline < today) return "expired";
  const remainingDays = Math.ceil((Date.parse(`${deadline}T23:59:59Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return remainingDays <= CALL_CLOSING_WINDOW_DAYS ? "closing" : "open";
}

export function isCallVisibleByDefault(
  call: { status: CallStatus; submissionDeadline: string | null },
  now: Date | string = new Date(),
) {
  const today = dateOnly(now);
  return call.status !== "expired" && (!call.submissionDeadline || call.submissionDeadline >= today);
}

export function sortCallsByDeadline<T extends { submissionDeadline: string | null; title: string }>(calls: T[]) {
  return [...calls].sort((left, right) => {
    if (!left.submissionDeadline && !right.submissionDeadline) return left.title.localeCompare(right.title);
    if (!left.submissionDeadline) return 1;
    if (!right.submissionDeadline) return -1;
    return left.submissionDeadline.localeCompare(right.submissionDeadline) || left.title.localeCompare(right.title);
  });
}
