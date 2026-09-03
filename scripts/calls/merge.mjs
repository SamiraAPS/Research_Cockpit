import { CALLS_CLOSING_WINDOW_DAYS } from "./config.mjs";
import { sha256 } from "./adapters/shared.mjs";
import { normalizeTitle } from "../ingestion/normalize.mjs";

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().toLowerCase();
  } catch {
    return String(value ?? "").toLowerCase();
  }
}

function datePart(value) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function identityKeys(call) {
  return [
    call.sourceKey && call.sourceRecordId ? `source:${call.sourceKey}:${call.sourceRecordId}` : null,
    call.officialUrl ? `url-title:${normalizedUrl(call.officialUrl)}|${normalizeTitle(call.title)}` : null,
    `title:${normalizeTitle(call.title)}|${normalizeTitle(call.venue)}|${datePart(call.deadlineAt)}`
  ].filter(Boolean);
}

function canonicalContent(call) {
  return {
    title: call.title,
    venue: call.venue,
    callType: call.callType,
    organizer: call.organizer,
    description: call.description,
    officialUrl: call.officialUrl,
    opensAt: call.opensAt,
    deadlineAt: call.deadlineAt,
    deadlineTimezone: call.deadlineTimezone,
    eventDate: call.eventDate,
    topics: [...call.topics].sort(),
    parserVersion: call.parserVersion,
    sourceVersion: call.sourceVersion,
    sourceKey: call.sourceKey,
    sourceName: call.sourceName,
    sourceRecordId: call.sourceRecordId
  };
}

export function calculateCallStatus(call, now = new Date(), verified = true) {
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now);
  if (call.deadlineAt) {
    const deadlineTime = Date.parse(call.deadlineAt);
    if (!Number.isNaN(deadlineTime) && deadlineTime < nowTime) return "expired";
  } else if (call.eventDate) {
    const eventEnd = Date.parse(`${call.eventDate}T23:59:59Z`);
    if (!Number.isNaN(eventEnd) && eventEnd < nowTime) return "expired";
  }
  if (!verified || !call.deadlineAt) return "unverified";
  const remainingDays = Math.ceil((Date.parse(call.deadlineAt) - nowTime) / 86_400_000);
  return remainingDays <= CALLS_CLOSING_WINDOW_DAYS ? "closing-soon" : "open";
}

function versionSnapshot(call, contentHash, observedAt, version) {
  return {
    version,
    contentHash,
    observedAt,
    title: call.title,
    description: call.description,
    officialUrl: call.officialUrl,
    deadlineAt: call.deadlineAt,
    eventDate: call.eventDate,
    topics: [...call.topics]
  };
}

function callId(call) {
  return `call-${sha256(identityKeys(call)[0] ?? JSON.stringify(canonicalContent(call))).slice(0, 20)}`;
}

function deduplicateCandidates(candidates) {
  const result = [];
  const index = new Map();
  let duplicateCount = 0;
  for (const candidate of candidates) {
    const match = identityKeys(candidate).map((key) => index.get(key)).find((value) => value !== undefined);
    if (match !== undefined) {
      duplicateCount += 1;
      const current = result[match];
      current.topics = [...new Set([...current.topics, ...candidate.topics])];
      current.sourceKeys = [...new Set([...(current.sourceKeys ?? [current.sourceKey]), candidate.sourceKey])];
      identityKeys(candidate).forEach((key) => index.set(key, match));
      continue;
    }
    const nextIndex = result.length;
    result.push({ ...candidate, sourceKeys: [candidate.sourceKey] });
    identityKeys(candidate).forEach((key) => index.set(key, nextIndex));
  }
  return { candidates: result, duplicateCount };
}

export function mergeCalls(previousItems, freshCandidates, sourceResults, generatedAt) {
  const deduplicated = deduplicateCandidates(freshCandidates);
  const oldIndexes = new Map();
  previousItems.forEach((call, index) => identityKeys(call).forEach((key) => oldIndexes.set(key, index)));
  const matchedOld = new Set();
  let newCount = 0;
  let updatedCount = 0;

  const items = deduplicated.candidates.map((candidate) => {
    const oldIndex = identityKeys(candidate).map((key) => oldIndexes.get(key)).find((value) => value !== undefined);
    const old = oldIndex === undefined ? null : previousItems[oldIndex];
    if (oldIndex !== undefined) matchedOld.add(oldIndex);
    const contentHash = sha256(canonicalContent(candidate));
    const oldVersions = Array.isArray(old?.versions) ? old.versions : [];
    const changed = !old || old.contentHash !== contentHash;
    const versions = changed
      ? [...oldVersions, versionSnapshot(candidate, contentHash, generatedAt, oldVersions.length + 1)]
      : oldVersions;
    if (!old) newCount += 1;
    else if (changed) updatedCount += 1;
    return {
      id: old?.id ?? callId(candidate),
      ...canonicalContent(candidate),
      sourceKeys: [...new Set([...(old?.sourceKeys ?? []), ...(candidate.sourceKeys ?? [candidate.sourceKey])])],
      contentHash,
      createdAt: old?.createdAt ?? generatedAt,
      lastCheckedAt: generatedAt,
      lastVerifiedAt: generatedAt,
      status: calculateCallStatus(candidate, generatedAt, true),
      versions
    };
  });

  previousItems.forEach((old, index) => {
    if (matchedOld.has(index)) return;
    const result = sourceResults.get(old.sourceKey);
    const wasChecked = Boolean(result?.checked);
    items.push({
      ...old,
      lastCheckedAt: wasChecked ? generatedAt : old.lastCheckedAt,
      status: calculateCallStatus(old, generatedAt, false)
    });
  });

  items.sort((left, right) => {
    if (!left.deadlineAt && !right.deadlineAt) return left.title.localeCompare(right.title);
    if (!left.deadlineAt) return 1;
    if (!right.deadlineAt) return -1;
    return left.deadlineAt.localeCompare(right.deadlineAt) || left.title.localeCompare(right.title);
  });
  return {
    items,
    stats: {
      observed: freshCandidates.length,
      deduplicated: deduplicated.duplicateCount,
      created: newCount,
      updated: updatedCount,
      retainedHistorical: previousItems.length - matchedOld.size
    }
  };
}
