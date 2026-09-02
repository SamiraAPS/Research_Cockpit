import type { CallAgendaSignal, CallsData, RadarCall, RadarCallSourceStatus } from "@/app/radar-types";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Value } from "@/db/d1";
import { CALL_SOURCE_REGISTRY_VERSION, OFFICIAL_CALL_SOURCES } from "./config/sources.v1";
import { calculateCallStatus, sortCallsByDeadline } from "./status";
import type { CallSourceStateStatus, CallStatus, OfficialCallSource, ParsedCall } from "./types";

type CallRunStatus = "running" | "succeeded" | "partial" | "failed";
const CALL_THEME_ANALYSIS_VERSION = "calls-rule-based-1.0.0";

type SourceStateRow = {
  source_id: number;
  source_key: string;
  source_name: string;
  status: CallSourceStateStatus;
  approved_content_hash: string | null;
  last_content_hash: string | null;
  last_checked_at: string;
  verified_at: string | null;
  error_message: string | null;
  parser_version: string;
  source_version: string;
};

type CallRow = {
  id: string;
  source_key: string;
  source_name: string;
  source_state: CallSourceStateStatus | null;
  title: string;
  call_type: RadarCall["callType"];
  organizer: string;
  description: string;
  official_url: string;
  submission_deadline: string | null;
  event_or_publication_date: string | null;
  stored_status: CallStatus;
  parser_version: string;
  source_version: string;
  first_captured_at: string;
  last_seen_at: string;
  source_last_checked_at: string | null;
  verified_at: string | null;
  themes: string | null;
};

function statement(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  return values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);
}

async function first<T>(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  return statement(db, sql, values).first<T>();
}

async function all<T>(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  const result = await statement(db, sql, values).all<T>();
  return result.results ?? [];
}

async function run(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  return statement(db, sql, values).run();
}

async function hash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function ensureCallSource(db: D1DatabaseLike, source: OfficialCallSource, now: string) {
  await run(db, `
    INSERT INTO sources (key, name, kind, external_id, area, homepage_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Calls / Agenda', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name, kind = excluded.kind, external_id = excluded.external_id,
      area = excluded.area, homepage_url = excluded.homepage_url, updated_at = excluded.updated_at
  `, [source.key, source.name, source.kind, source.key, source.url, now, now]);
  const row = await first<{ id: number }>(db, "SELECT id FROM sources WHERE key = ?", [source.key]);
  if (!row) throw new Error(`Call source ${source.key} could not be initialized`);
  return row.id;
}

export async function createCallIngestionRun(db: D1DatabaseLike, sourceId: number, source: OfficialCallSource, startedAt: string) {
  const id = crypto.randomUUID();
  await run(db, `
    INSERT INTO call_ingestion_runs (
      id, source_id, status, registry_version, source_version, parser_version, started_at,
      found_count, new_count, updated_count, error_count, requires_manual_review
    ) VALUES (?, ?, 'running', ?, ?, ?, ?, 0, 0, 0, 0, 0)
  `, [id, sourceId, CALL_SOURCE_REGISTRY_VERSION, source.sourceVersion, source.parserVersion, startedAt]);
  return id;
}

export async function finishCallIngestionRun(db: D1DatabaseLike, input: {
  id: string;
  status: Exclude<CallRunStatus, "running">;
  foundCount: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  contentHash?: string | null;
  requiresManualReview?: boolean;
  errorMessage?: string | null;
  endedAt: string;
}) {
  await run(db, `
    UPDATE call_ingestion_runs SET status = ?, ended_at = ?, found_count = ?, new_count = ?,
      updated_count = ?, error_count = ?, content_hash = ?, requires_manual_review = ?, error_message = ?
    WHERE id = ?
  `, [input.status, input.endedAt, input.foundCount, input.newCount, input.updatedCount, input.errorCount,
    input.contentHash ?? null, input.requiresManualReview ? 1 : 0, input.errorMessage ?? null, input.id]);
}

export async function getCallSourceState(db: D1DatabaseLike, sourceId: number) {
  return first<SourceStateRow>(db, `
    SELECT css.*, s.key AS source_key, s.name AS source_name
    FROM call_source_state css JOIN sources s ON s.id = css.source_id
    WHERE css.source_id = ?
  `, [sourceId]);
}

export async function setCallSourceState(db: D1DatabaseLike, input: {
  sourceId: number;
  source: OfficialCallSource;
  status: CallSourceStateStatus;
  approvedContentHash?: string | null;
  lastContentHash?: string | null;
  checkedAt: string;
  verifiedAt?: string | null;
  errorMessage?: string | null;
}) {
  await run(db, `
    INSERT INTO call_source_state (
      source_id, registry_version, source_version, parser_version, status, approved_content_hash,
      last_content_hash, last_checked_at, verified_at, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      registry_version = excluded.registry_version,
      source_version = excluded.source_version,
      parser_version = excluded.parser_version,
      status = excluded.status,
      approved_content_hash = COALESCE(excluded.approved_content_hash, call_source_state.approved_content_hash),
      last_content_hash = COALESCE(excluded.last_content_hash, call_source_state.last_content_hash),
      last_checked_at = excluded.last_checked_at,
      verified_at = COALESCE(excluded.verified_at, call_source_state.verified_at),
      error_message = excluded.error_message
  `, [input.sourceId, CALL_SOURCE_REGISTRY_VERSION, input.source.sourceVersion, input.source.parserVersion,
    input.status, input.approvedContentHash ?? null, input.lastContentHash ?? null, input.checkedAt,
    input.verifiedAt ?? null, input.errorMessage ?? null]);
}

export async function persistCall(db: D1DatabaseLike, input: ParsedCall, context: {
  sourceId: number;
  source: OfficialCallSource;
  ingestionRunId: string;
  capturedAt: string;
  verified: boolean;
}) {
  const existing = await first<{ id: string; verified_at: string | null }>(db, `
    SELECT id, verified_at FROM calls WHERE source_id = ? AND source_record_id = ?
  `, [context.sourceId, input.sourceRecordId]);
  const callId = existing?.id ?? crypto.randomUUID();
  const status = calculateCallStatus(input.submissionDeadline, context.verified, context.capturedAt);
  const verifiedAt = context.verified ? context.capturedAt : existing?.verified_at ?? null;
  const contentHash = await hash({ ...input, verificationState: context.verified });
  const priorVersion = existing ? await first<{ content_hash: string }>(db, `
    SELECT content_hash FROM call_versions WHERE call_id = ? ORDER BY captured_at DESC LIMIT 1
  `, [callId]) : null;
  const knownVersion = existing ? await first<{ content_hash: string }>(db, `
    SELECT content_hash FROM call_versions WHERE call_id = ? AND content_hash = ? LIMIT 1
  `, [callId, contentHash]) : null;
  const changed = priorVersion?.content_hash !== contentHash;
  const statements: D1PreparedStatementLike[] = [];

  if (!existing) {
    statements.push(statement(db, `
      INSERT INTO calls (
        id, source_id, source_record_id, title, call_type, organizer, description, official_url,
        submission_deadline, event_or_publication_date, status, parser_version, source_version,
        first_captured_at, last_seen_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [callId, context.sourceId, input.sourceRecordId, input.title, input.callType, input.organizer,
      input.description, input.officialUrl, input.submissionDeadline, input.eventOrPublicationDate,
      status, context.source.parserVersion, context.source.sourceVersion, context.capturedAt, context.capturedAt, verifiedAt]));
  } else {
    statements.push(statement(db, `
      UPDATE calls SET title = ?, call_type = ?, organizer = ?, description = ?, official_url = ?,
        submission_deadline = ?, event_or_publication_date = ?, status = ?, parser_version = ?,
        source_version = ?, last_seen_at = ?, verified_at = ? WHERE id = ?
    `, [input.title, input.callType, input.organizer, input.description, input.officialUrl,
      input.submissionDeadline, input.eventOrPublicationDate, status, context.source.parserVersion,
      context.source.sourceVersion, context.capturedAt, verifiedAt, callId]));
  }

  if (changed && !knownVersion) {
    statements.push(statement(db, `
      INSERT INTO call_versions (
        id, call_id, ingestion_run_id, content_hash, title, call_type, organizer, description,
        official_url, submission_deadline, event_or_publication_date, topics_json, status,
        parser_version, source_version, captured_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [crypto.randomUUID(), callId, context.ingestionRunId, contentHash, input.title, input.callType,
      input.organizer, input.description, input.officialUrl, input.submissionDeadline,
      input.eventOrPublicationDate, JSON.stringify(input.themes), status, context.source.parserVersion,
      context.source.sourceVersion, context.capturedAt, context.verified ? context.capturedAt : null]));
  }
  statements.push(statement(db, "DELETE FROM call_themes WHERE call_id = ?", [callId]));
  for (const theme of input.themes) {
    statements.push(statement(db, `
      INSERT INTO call_themes (call_id, theme, analysis_version, updated_at) VALUES (?, ?, ?, ?)
    `, [callId, theme, CALL_THEME_ANALYSIS_VERSION, context.capturedAt]));
  }
  await db.batch(statements);
  return { id: callId, isNew: !existing, updated: Boolean(existing && changed) };
}

export async function markMissingCallsUnverified(db: D1DatabaseLike, sourceId: number, observedRecordIds: string[]) {
  const placeholders = observedRecordIds.map(() => "?").join(", ");
  await run(db, `
    UPDATE calls SET status = 'unverified'
    WHERE source_id = ?${observedRecordIds.length ? ` AND source_record_id NOT IN (${placeholders})` : ""}
  `, [sourceId, ...observedRecordIds]);
}

function sourceAvailability(states: SourceStateRow[], storedCalls: number) {
  if (states.length === 0) return { status: "unavailable" as const, error: "Calls: Noch keine offizielle Quelle geprüft." };
  if (states.length === OFFICIAL_CALL_SOURCES.length && states.every((state) => state.status === "verified")) {
    return { status: "live" as const, error: null };
  }
  if (states.some((state) => state.status === "verified") || storedCalls > 0) {
    return { status: "partial" as const, error: "Calls: Mindestens eine offizielle Quelle fehlt, ist verändert oder erfordert eine manuelle Prüfung." };
  }
  return { status: "unavailable" as const, error: "Calls: Die offiziellen Quellen sind nicht verifiziert oder nicht erreichbar." };
}

function agendaSignals(calls: RadarCall[]) {
  const active = calls.filter((call) => call.status === "open" || call.status === "closing");
  const themes = new Map<string, CallAgendaSignal>();
  for (const call of active) {
    for (const theme of call.themes) {
      const current = themes.get(theme) ?? { theme, count: 0, closingCount: 0, nearestDeadline: null };
      current.count += 1;
      if (call.status === "closing") current.closingCount += 1;
      if (call.submissionDeadline && (!current.nearestDeadline || call.submissionDeadline < current.nearestDeadline)) {
        current.nearestDeadline = call.submissionDeadline;
      }
      themes.set(theme, current);
    }
  }
  return [...themes.values()].sort((left, right) => right.count - left.count || left.theme.localeCompare(right.theme));
}

export async function readCallsData(db: D1DatabaseLike, now = new Date().toISOString()): Promise<CallsData> {
  const [rows, states] = await Promise.all([
    all<CallRow>(db, `
      SELECT c.id, s.key AS source_key, s.name AS source_name, css.status AS source_state,
        c.title, c.call_type, c.organizer, c.description, c.official_url, c.submission_deadline,
        c.event_or_publication_date, c.status AS stored_status, c.parser_version, c.source_version,
        c.first_captured_at, c.last_seen_at, css.last_checked_at AS source_last_checked_at, c.verified_at,
        GROUP_CONCAT(DISTINCT ct.theme) AS themes
      FROM calls c
      JOIN sources s ON s.id = c.source_id
      LEFT JOIN call_source_state css ON css.source_id = c.source_id
      LEFT JOIN call_themes ct ON ct.call_id = c.id
      GROUP BY c.id
    `),
    all<SourceStateRow>(db, `
      SELECT css.*, s.key AS source_key, s.name AS source_name
      FROM call_source_state css JOIN sources s ON s.id = css.source_id
      ORDER BY s.name
    `),
  ]);
  const calls = sortCallsByDeadline(rows.map((row): RadarCall => {
    const verified = row.source_state === "verified" && row.stored_status !== "unverified" && Boolean(row.verified_at);
    return {
      id: row.id,
      title: row.title,
      callType: row.call_type,
      organizer: row.organizer,
      description: row.description,
      officialUrl: row.official_url,
      submissionDeadline: row.submission_deadline,
      eventOrPublicationDate: row.event_or_publication_date,
      themes: row.themes?.split(",").filter(Boolean) ?? [],
      capturedAt: row.first_captured_at,
      lastCheckedAt: row.source_last_checked_at ?? row.last_seen_at,
      verifiedAt: row.verified_at,
      status: calculateCallStatus(row.submission_deadline, verified, now),
      parserVersion: row.parser_version,
      sourceVersion: row.source_version,
      sourceKey: row.source_key,
      sourceName: row.source_name,
    };
  }));
  const counts = {
    totalStored: calls.length,
    active: calls.filter((call) => call.status === "open" || call.status === "closing").length,
    open: calls.filter((call) => call.status === "open").length,
    closing: calls.filter((call) => call.status === "closing").length,
    expired: calls.filter((call) => call.status === "expired").length,
    unverified: calls.filter((call) => call.status === "unverified").length,
  };
  const status = sourceAvailability(states, calls.length);
  const sourceStates: RadarCallSourceStatus[] = OFFICIAL_CALL_SOURCES.map((source) => {
    const state = states.find((candidate) => candidate.source_key === source.key);
    return {
      key: source.key,
      name: source.name,
      officialUrl: source.url,
      status: state?.status ?? "unavailable",
      lastCheckedAt: state?.last_checked_at ?? null,
      verifiedAt: state?.verified_at ?? null,
      error: state?.error_message ?? (state ? null : "Noch nicht geprüft."),
      parserVersion: state?.parser_version ?? source.parserVersion,
      sourceVersion: state?.source_version ?? source.sourceVersion,
    };
  });
  return {
    status,
    registryVersion: CALL_SOURCE_REGISTRY_VERSION,
    verifiedAt: states.map((state) => state.verified_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    calls,
    agendaSignals: agendaSignals(calls),
    counts,
    sources: sourceStates,
    interpretation: "Calls zeigen institutionelle Nachfrage und Agenda-Setzung, nicht wissenschaftliche Evidenz oder erwartete Publikationsmengen.",
  };
}
