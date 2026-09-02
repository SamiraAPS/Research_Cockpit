import type { DatasetAvailability, RadarData, RadarThemeClassification, RadarTrendPoint, RadarWork } from "@/app/radar-types";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Value } from "@/db/d1";
import { readCallsData } from "../calls/repository";
import { classifyThemeEvidence } from "./classification";
import {
  AI_TERMS,
  ANALYSIS_VERSION,
  CACHE_DURATION_SECONDS,
  CORE_CONFERENCES,
  FIELD_TERMS,
  HUMAN_AI_TERMS,
  JOURNALS,
  PREPRINT_SOURCES,
  SEARCH_CONFIG_VERSION,
  SEARCH_LAYERS,
  STALE_WHILE_REVALIDATE_SECONDS,
  buildRadarWork,
  normalizeTitle,
  overallStatus,
  type SearchLayer,
} from "./config";
import {
  findThemeDefinition,
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY_VERSION,
  THEME_SCORE_THRESHOLD,
} from "./config/themes.v2";
import { buildResearchQuestions, buildThemeAnalysis } from "./questions";
import { METHODOLOGY_MANIFEST } from "./config/methodology.v1";
import { readDataQualityReport } from "./quality";
import { readThemeSignalAnalysis } from "./trend-repository";
import type { IngestibleWork, WorkDiscoveryContext, WorkVersionType } from "./work";

export type IngestionDataset = SearchLayer | "trends";
export type IngestionScope = "ai" | "field" | "all";
export type IngestionStatus = "running" | "succeeded" | "partial" | "failed";
export type IngestionProvider = "openalex" | "arxiv" | "crossref";

export const INGESTION_SOURCE_KEYS = {
  core: "openalex-core",
  broad: "openalex-broad",
  frontier: "openalex-frontier",
  arxiv: "arxiv-frontier",
  crossref: "crossref-enrichment",
  trends: "openalex-trends",
} as const;

type SourceInput = {
  key: string;
  name: string;
  kind: "provider" | "journal" | "conference" | "repository";
  externalId?: string | null;
  area?: string | null;
  homepageUrl?: string | null;
};

type IngestionRunRow = {
  id: string;
  source_key: string;
  search_layer: SearchLayer | "trends";
  status: IngestionStatus;
  started_at: string;
  ended_at: string | null;
  found_count: number;
  loaded_count: number;
  new_count: number;
  updated_count: number;
  error_count: number;
  error_message: string | null;
  safety_limit: number;
  limit_reached: number;
};

type WorkRow = { id: string };
type CurrentVersionRow = { id: string; content_hash: string };
type FuzzyCandidateRow = {
  id: string;
  doi_normalized: string | null;
  title: string;
  authors_json: string;
  publication_date: string | null;
  version_type: WorkVersionType;
};

type DashboardWorkRow = {
  work_id: string;
  version_type: WorkVersionType;
  title: string;
  authors_json: string;
  source_name: string;
  publication_date: string | null;
  url: string;
  is_open_access: number;
  cited_by_count: number;
  retrieved_at: string;
  theme_classifications: string | null;
  search_layers: string | null;
};

type TrendSnapshotRow = { year: number; publication_type: "article" | "preprint"; record_count: number };

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

function sourceKey(input: IngestibleWork) {
  const externalId = input.sourceExternalId?.split("/").pop();
  if (externalId) return `${input.provider}-source:${externalId}`;
  return `${input.provider}-source-name:${normalizeTitle(input.sourceName)}`;
}

export async function ensureSource(db: D1DatabaseLike, input: SourceInput, now = new Date().toISOString()) {
  await run(db, `
    INSERT INTO sources (key, name, kind, external_id, area, homepage_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      external_id = COALESCE(excluded.external_id, sources.external_id),
      area = COALESCE(excluded.area, sources.area),
      homepage_url = COALESCE(excluded.homepage_url, sources.homepage_url),
      updated_at = excluded.updated_at
  `, [input.key, input.name, input.kind, input.externalId ?? null, input.area ?? null, input.homepageUrl ?? null, now, now]);
  const row = await first<{ id: number }>(db, "SELECT id FROM sources WHERE key = ?", [input.key]);
  if (!row) throw new Error(`Source ${input.key} could not be initialized`);
  return row.id;
}

export async function ensureIngestionSource(
  db: D1DatabaseLike,
  dataset: IngestionDataset | "publications" | "preprints",
  now?: string,
  provider: IngestionProvider = "openalex",
) {
  const layer: IngestionDataset = dataset === "publications" ? "core" : dataset === "preprints" ? "frontier" : dataset;
  const key = layer === "trends"
    ? INGESTION_SOURCE_KEYS.trends
    : provider === "arxiv"
      ? INGESTION_SOURCE_KEYS.arxiv
      : provider === "crossref"
        ? INGESTION_SOURCE_KEYS.crossref
        : INGESTION_SOURCE_KEYS[layer];
  const names: Record<string, string> = {
    [INGESTION_SOURCE_KEYS.core]: "OpenAlex core discovery",
    [INGESTION_SOURCE_KEYS.broad]: "OpenAlex broad discovery",
    [INGESTION_SOURCE_KEYS.frontier]: "OpenAlex frontier discovery",
    [INGESTION_SOURCE_KEYS.arxiv]: "arXiv frontier discovery",
    [INGESTION_SOURCE_KEYS.crossref]: "Crossref metadata enrichment",
    [INGESTION_SOURCE_KEYS.trends]: "OpenAlex trend ingestion",
  };
  const homepage = provider === "arxiv" ? "https://arxiv.org" : provider === "crossref" ? "https://crossref.org" : "https://openalex.org";
  return ensureSource(db, { key, name: names[key], kind: "provider", homepageUrl: homepage }, now);
}

export async function createIngestionRun(
  db: D1DatabaseLike,
  input: {
    sourceId: number;
    scope: IngestionScope;
    searchLayer?: SearchLayer | "trends";
    queryVersion: string;
    safetyLimit?: number;
    startedAt?: string;
    id?: string;
  },
) {
  const id = input.id ?? crypto.randomUUID();
  const startedAt = input.startedAt ?? new Date().toISOString();
  await run(db, `
    INSERT INTO ingestion_runs (
      id, source_id, scope, search_layer, status, query_version, safety_limit, limit_reached, started_at,
      found_count, loaded_count, new_count, updated_count, error_count
    ) VALUES (?, ?, ?, ?, 'running', ?, ?, 0, ?, 0, 0, 0, 0, 0)
  `, [id, input.sourceId, input.scope, input.searchLayer ?? "core", input.queryVersion, input.safetyLimit ?? 5000, startedAt]);
  return { id, startedAt };
}

export async function finishIngestionRun(
  db: D1DatabaseLike,
  input: {
    id: string;
    status: Exclude<IngestionStatus, "running">;
    foundCount: number;
    loadedCount: number;
    newCount: number;
    updatedCount: number;
    errorCount: number;
    errorMessage?: string | null;
    limitReached?: boolean;
    endedAt?: string;
  },
) {
  await run(db, `
    UPDATE ingestion_runs SET
      status = ?, ended_at = ?, found_count = ?, loaded_count = ?, new_count = ?,
      updated_count = ?, error_count = ?, error_message = ?, limit_reached = ?
    WHERE id = ?
  `, [input.status, input.endedAt ?? new Date().toISOString(), input.foundCount, input.loadedCount, input.newCount, input.updatedCount, input.errorCount, input.errorMessage ?? null, input.limitReached ? 1 : 0, input.id]);
}

export async function recordSourceHealth(
  db: D1DatabaseLike,
  input: {
    sourceId: number;
    ingestionRunId: string;
    checkName: string;
    status: "healthy" | "degraded" | "unavailable";
    latencyMs?: number | null;
    httpStatus?: number | null;
    errorMessage?: string | null;
    checkedAt?: string;
  },
) {
  await run(db, `
    INSERT INTO source_health (
      source_id, ingestion_run_id, check_name, status, latency_ms, http_status, error_message, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [input.sourceId, input.ingestionRunId, input.checkName, input.status, input.latencyMs ?? null, input.httpStatus ?? null, input.errorMessage ?? null, input.checkedAt ?? new Date().toISOString()]);
}

async function contentHash(input: IngestibleWork) {
  const serialized = JSON.stringify({
    title: input.title,
    abstract: input.abstract,
    authors: input.authors,
    doi: input.doiNormalized,
    source: input.sourceName,
    type: input.sourceType,
    publicationDate: input.publicationDate,
    onlineDate: input.onlineDate,
    url: input.url,
    openAccess: input.isOpenAccess,
    openAccessStatus: input.openAccessStatus,
    citedBy: input.citedByCount,
    topics: input.topics,
    keywords: input.keywords,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function titleTokens(value: string) {
  return normalizeTitle(value).split(" ").filter((token) => token.length > 1);
}

function jaccardSimilarity(left: string[], right: string[]) {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function editSimilarity(left: string, right: string) {
  if (left === right) return 1;
  const rows = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = rows[0];
    rows[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = rows[rightIndex];
      rows[rightIndex] = Math.min(
        rows[rightIndex] + 1,
        rows[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - rows[right.length] / Math.max(left.length, right.length, 1);
}

function authorSurnames(value: string | IngestibleWork["authors"]) {
  try {
    const authors = typeof value === "string" ? JSON.parse(value) as Array<{ name?: string }> : value;
    return authors.flatMap((author) => {
      const name = author.name?.trim();
      return name ? [normalizeTitle(name).split(" ").at(-1) ?? ""] : [];
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function cautiousTitleSimilarity(input: IngestibleWork, candidate: FuzzyCandidateRow) {
  const left = normalizeTitle(input.title);
  const right = normalizeTitle(candidate.title);
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.length < 5 || rightTokens.length < 5) return 0;
  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (lengthRatio < 0.85) return 0;
  const jaccard = jaccardSimilarity(leftTokens, rightTokens);
  const edit = editSimilarity(left, right);
  const score = Math.min(jaccard, edit);
  if (score < 0.9) return 0;
  const inputYear = Number(input.publicationDate?.slice(0, 4));
  const candidateYear = Number(candidate.publication_date?.slice(0, 4));
  if (inputYear && candidateYear && Math.abs(inputYear - candidateYear) > 1) return 0;
  const inputAuthors = authorSurnames(input.authors);
  const candidateAuthors = authorSurnames(candidate.authors_json);
  const authorMatches = inputAuthors.length > 0 && candidateAuthors.length > 0 && inputAuthors.some((author) => candidateAuthors.includes(author));
  if (input.doiNormalized && candidate.doi_normalized && input.doiNormalized !== candidate.doi_normalized) {
    return input.sourceType !== candidate.version_type && authorMatches && score >= 0.97 ? score : 0;
  }
  if (!authorMatches && inputAuthors.length > 0 && candidateAuthors.length > 0) return 0;
  return authorMatches ? score : score >= 0.98 ? score : 0;
}

async function fuzzyWork(db: D1DatabaseLike, input: IngestibleWork) {
  const prefix = input.normalizedTitle.slice(0, 12).replace(/[\\%_]/g, "\\$&");
  if (prefix.length < 8) return null;
  const candidates = await all<FuzzyCandidateRow>(db, `
    SELECT w.id, w.doi_normalized, v.title, v.authors_json, v.publication_date, v.version_type
    FROM works w
    JOIN work_versions v ON v.work_id = w.id AND v.is_current = 1
    WHERE w.normalized_title LIKE ? ESCAPE '\\'
    ORDER BY w.last_seen_at DESC
    LIMIT 100
  `, [`${prefix}%`]);
  return candidates
    .map((candidate) => ({ candidate, score: cautiousTitleSimilarity(input, candidate) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.candidate.id ?? null;
}

async function findWork(db: D1DatabaseLike, input: IngestibleWork, sourceId: number): Promise<{ id: string | null; method: string }> {
  if (input.doiNormalized) {
    const byDoi = await first<WorkRow>(db, `
      SELECT w.id FROM works w
      LEFT JOIN work_sources ws ON ws.work_id = w.id
      WHERE w.doi_normalized = ? OR ws.doi_normalized = ?
      LIMIT 1
    `, [input.doiNormalized, input.doiNormalized]);
    if (byDoi) return { id: byDoi.id, method: "doi" };
  }
  if (input.openAlexId) {
    const byOpenAlex = await first<WorkRow>(db, `
      SELECT w.id FROM works w
      LEFT JOIN work_sources ws ON ws.work_id = w.id
      WHERE w.primary_openalex_id = ? OR ws.openalex_id = ?
      LIMIT 1
    `, [input.openAlexId, input.openAlexId]);
    if (byOpenAlex) return { id: byOpenAlex.id, method: "openalex-id" };
  }
  const bySourceRecord = await first<WorkRow>(db, `
    SELECT work_id AS id FROM work_sources
    WHERE source_id = ? AND source_record_id = ?
    LIMIT 1
  `, [sourceId, input.sourceRecordId]);
  if (bySourceRecord) return { id: bySourceRecord.id, method: "source-record-id" };
  const byTitle = await first<WorkRow>(db, "SELECT id FROM works WHERE normalized_title = ? ORDER BY created_at LIMIT 1", [input.normalizedTitle]);
  if (byTitle) return { id: byTitle.id, method: "normalized-title" };
  const fuzzy = await fuzzyWork(db, input);
  return { id: fuzzy, method: fuzzy ? "cautious-title-similarity" : "new" };
}

export async function persistWork(db: D1DatabaseLike, input: IngestibleWork, context: WorkDiscoveryContext) {
  const sourceId = await ensureSource(db, {
    key: sourceKey(input),
    name: input.sourceName,
    kind: input.sourceKind,
    externalId: input.sourceExternalId,
  }, input.retrievedAt);
  const match = await findWork(db, input, sourceId);
  let workId = match.id;
  const isNew = workId === null;
  workId ??= crypto.randomUUID();
  const hash = await contentHash(input);
  const currentVersion = await first<CurrentVersionRow>(db, `
    SELECT id, content_hash FROM work_versions
    WHERE work_id = ? AND version_type = ? AND is_current = 1
    LIMIT 1
  `, [workId, input.sourceType]);
  const versionChanged = currentVersion?.content_hash !== hash;
  const sourceLink = await first<{ id: number }>(db, `
    SELECT id FROM work_sources
    WHERE (? IS NOT NULL AND openalex_id = ?) OR (source_id = ? AND source_record_id = ?)
    LIMIT 1
  `, [input.openAlexId, input.openAlexId, sourceId, input.sourceRecordId]);
  const statements: D1PreparedStatementLike[] = [];

  if (isNew) {
    statements.push(statement(db, `
      INSERT INTO works (
        id, primary_doi, doi_normalized, primary_openalex_id, normalized_title,
        created_at, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [workId, input.doi, input.doiNormalized, input.openAlexId, input.normalizedTitle, input.retrievedAt, input.retrievedAt, input.retrievedAt]));
  } else {
    statements.push(statement(db, `
      UPDATE works SET
        primary_doi = COALESCE(primary_doi, ?),
        doi_normalized = COALESCE(doi_normalized, ?),
        primary_openalex_id = COALESCE(primary_openalex_id, ?),
        last_seen_at = ?
      WHERE id = ?
    `, [input.doi, input.doiNormalized, input.openAlexId, input.retrievedAt, workId]));
  }

  if (sourceLink) {
    statements.push(statement(db, `
      UPDATE work_sources SET work_id = ?, doi_normalized = COALESCE(doi_normalized, ?),
        openalex_id = COALESCE(openalex_id, ?), last_seen_at = ?
      WHERE id = ?
    `, [workId, input.doiNormalized, input.openAlexId, input.retrievedAt, sourceLink.id]));
  } else {
    statements.push(statement(db, `
      INSERT INTO work_sources (
        work_id, source_id, doi_normalized, openalex_id, source_record_id, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [workId, sourceId, input.doiNormalized, input.openAlexId, input.sourceRecordId, input.retrievedAt, input.retrievedAt]));
  }

  statements.push(statement(db, `
    INSERT INTO work_scopes (work_id, scope, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(work_id, scope) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `, [workId, context.scope, input.retrievedAt, input.retrievedAt]));

  if (versionChanged) {
    if (currentVersion) statements.push(statement(db, "UPDATE work_versions SET is_current = 0 WHERE id = ?", [currentVersion.id]));
    statements.push(statement(db, `
      INSERT INTO work_versions (
        id, work_id, ingestion_run_id, source_id, content_hash, version_type,
        title, abstract, authors_json, doi, doi_normalized, openalex_id, source_record_id,
        source_name, publication_date, online_date, url, is_open_access, open_access_status, cited_by_count,
        topics_json, keywords_json, retrieved_at, created_at, is_current
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [crypto.randomUUID(), workId, context.ingestionRunId, sourceId, hash, input.sourceType, input.title, input.abstract, JSON.stringify(input.authors), input.doi, input.doiNormalized, input.openAlexId, input.sourceRecordId, input.sourceName, input.publicationDate, input.onlineDate, input.url, input.isOpenAccess ? 1 : 0, input.openAccessStatus, input.citedByCount, JSON.stringify(input.topics), JSON.stringify(input.keywords), input.retrievedAt, input.retrievedAt]));
  }

  statements.push(statement(db, `
    INSERT INTO work_discoveries (
      work_id, ingestion_run_id, source_id, provider, source_record_id, search_layer, query_version, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ingestion_run_id, provider, source_record_id, search_layer) DO NOTHING
  `, [workId, context.ingestionRunId, sourceId, input.provider, input.sourceRecordId, context.searchLayer, context.queryVersion, input.retrievedAt]));

  const classifications = classifyThemeEvidence({
    title: input.title,
    abstract: input.abstract,
    topics: input.topics,
    keywords: input.keywords,
  });
  statements.push(statement(db, "DELETE FROM work_themes WHERE work_id = ?", [workId]));
  for (const classification of classifications) {
    statements.push(statement(db, `
      INSERT INTO work_themes (
        work_id, theme, analysis_version, classification_version, ontology_version,
        score, evidence_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [workId, classification.theme, ANALYSIS_VERSION, classification.classificationVersion,
      classification.ontologyVersion, classification.score, JSON.stringify(classification.evidence), input.retrievedAt]));
  }

  await db.batch(statements);
  return { workId, isNew, updated: !isNew && versionChanged, versionChanged, deduplicationMethod: match.method };
}

export async function insertTrendSnapshots(
  db: D1DatabaseLike,
  input: {
    ingestionRunId: string;
    sourceId: number;
    scope: "ai" | "field";
    publicationType: "article" | "preprint";
    groups: Array<{ year: number; count: number }>;
    capturedAt: string;
    queryVersion: string;
  },
) {
  if (input.groups.length === 0) return;
  await db.batch(input.groups.map((group) => statement(db, `
    INSERT INTO trend_snapshots (
      ingestion_run_id, source_id, scope, publication_type, year, record_count, captured_at, query_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [input.ingestionRunId, input.sourceId, input.scope, input.publicationType, group.year, group.count, input.capturedAt, input.queryVersion])));
}

function dataStatusFromRuns(runs: Array<IngestionRunRow | null>, label: string): DatasetAvailability {
  const availableRuns = runs.filter((run): run is IngestionRunRow => Boolean(run));
  if (availableRuns.length === 0) return { status: "unavailable", error: `${label}: Noch kein Ingestion-Lauf vorhanden.` };
  if (availableRuns.every((run) => run.status === "succeeded") && availableRuns.length === runs.length) return { status: "live", error: null };
  if (availableRuns.every((run) => run.status === "failed")) return { status: "unavailable", error: `${label}: Alle letzten Quellenläufe sind fehlgeschlagen.` };
  return { status: "partial", error: `${label}: Mindestens eine Quelle fehlt, läuft noch oder war nur teilweise erfolgreich.` };
}

async function latestRun(db: D1DatabaseLike, sourceKeyValue: string, layer: SearchLayer | "trends", scope: IngestionScope) {
  return first<IngestionRunRow>(db, `
    SELECT ir.id, s.key AS source_key, ir.search_layer, ir.status, ir.started_at, ir.ended_at,
      ir.found_count, ir.loaded_count, ir.new_count, ir.updated_count, ir.error_count,
      ir.error_message, ir.safety_limit, ir.limit_reached
    FROM ingestion_runs ir
    JOIN sources s ON s.id = ir.source_id
    WHERE s.key = ? AND ir.search_layer = ? AND ir.scope = ?
    ORDER BY ir.started_at DESC
    LIMIT 1
  `, [sourceKeyValue, layer, scope]);
}

function parseAuthors(value: string) {
  try {
    const parsed = JSON.parse(value) as Array<{ name?: unknown }>;
    return parsed.map((author) => typeof author.name === "string" ? author.name : "").filter(Boolean).slice(0, 4);
  } catch {
    return [];
  }
}

function parseThemeClassifications(value: string | null): RadarThemeClassification[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<{
      theme?: unknown;
      score?: unknown;
      classificationVersion?: unknown;
      ontologyVersion?: unknown;
      evidence?: unknown;
    }>;
    return parsed.flatMap((item) => {
      if (typeof item.theme !== "string" || typeof item.score !== "number" ||
          typeof item.classificationVersion !== "string" || typeof item.ontologyVersion !== "string" ||
          !Array.isArray(item.evidence)) return [];
      const theme = findThemeDefinition(item.theme);
      return [{
        theme: item.theme,
        label: theme?.label ?? item.theme,
        score: item.score,
        classificationVersion: item.classificationVersion,
        ontologyVersion: item.ontologyVersion,
        evidence: item.evidence as RadarThemeClassification["evidence"],
      }];
    }).sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme));
  } catch {
    return [];
  }
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function readWorks(db: D1DatabaseLike, scope: "ai" | "field", days: number, layers: SearchLayer[]): Promise<RadarWork[]> {
  const placeholders = layers.map(() => "?").join(", ");
  const rows = await all<DashboardWorkRow>(db, `
    SELECT
      w.id AS work_id, v.version_type, v.title, v.authors_json, v.source_name,
      v.publication_date, v.url, v.is_open_access, v.cited_by_count, v.retrieved_at,
      (SELECT json_group_array(json_object(
        'theme', wt.theme,
        'score', wt.score,
        'classificationVersion', wt.classification_version,
        'ontologyVersion', wt.ontology_version,
        'evidence', json(wt.evidence_json)
      )) FROM work_themes wt WHERE wt.work_id = w.id) AS theme_classifications,
      (SELECT GROUP_CONCAT(DISTINCT wd2.search_layer) FROM work_discoveries wd2 WHERE wd2.work_id = w.id) AS search_layers
    FROM works w
    JOIN work_scopes sc ON sc.work_id = w.id AND sc.scope = ?
    JOIN work_versions v ON v.work_id = w.id AND v.is_current = 1
    WHERE v.publication_date >= ?
      AND EXISTS (
        SELECT 1 FROM work_discoveries wd
        WHERE wd.work_id = w.id AND wd.search_layer IN (${placeholders})
    )
    ORDER BY v.publication_date DESC, v.retrieved_at DESC
  `, [scope, dateDaysAgo(days), ...layers]);
  const priority: Record<WorkVersionType, number> = { journal: 3, proceedings: 2, preprint: 1 };
  const preferred = new Map<string, DashboardWorkRow>();
  for (const row of rows) {
    const current = preferred.get(row.work_id);
    if (!current || priority[row.version_type] > priority[current.version_type]) preferred.set(row.work_id, row);
  }
  return [...preferred.values()].map((row) => {
    const themeClassifications = parseThemeClassifications(row.theme_classifications).filter((classification) =>
      classification.classificationVersion === THEME_CLASSIFICATION_VERSION &&
      classification.ontologyVersion === THEME_ONTOLOGY_VERSION &&
      classification.score >= THEME_SCORE_THRESHOLD);
    return buildRadarWork({
      id: row.work_id,
      title: row.title,
      publicationDate: row.publication_date ?? "",
      source: row.source_name,
      sourceType: row.version_type,
      searchLayers: (row.search_layers?.split(",").filter((layer): layer is SearchLayer => SEARCH_LAYERS.includes(layer as SearchLayer)) ?? []),
      authors: parseAuthors(row.authors_json),
      citedBy: row.cited_by_count,
      url: row.url,
      isOpenAccess: Boolean(row.is_open_access),
      themes: themeClassifications.map((classification) => classification.theme),
      themeClassifications,
    });
  }).sort((a, b) => b.publicationDate.localeCompare(a.publicationDate) || b.relevanceScore - a.relevanceScore);
}

async function readTrend(db: D1DatabaseLike, ingestionRun: IngestionRunRow | null, scope: "ai" | "field"): Promise<RadarTrendPoint[]> {
  if (!ingestionRun || ingestionRun.status === "failed") return [];
  const rows = await all<TrendSnapshotRow>(db, `
    SELECT year, publication_type, record_count
    FROM trend_snapshots
    WHERE ingestion_run_id = ? AND scope = ?
    ORDER BY year
  `, [ingestionRun.id, scope]);
  if (rows.length === 0) return [];
  const hasArticle = rows.some((row) => row.publication_type === "article");
  const hasPreprint = rows.some((row) => row.publication_type === "preprint");
  const currentYear = new Date().getUTCFullYear();
  const points = new Map<number, RadarTrendPoint>();
  for (let year = currentYear - 11; year <= currentYear; year += 1) {
    points.set(year, { year, article: hasArticle ? 0 : null, preprint: hasPreprint ? 0 : null });
  }
  for (const row of rows) {
    const point = points.get(row.year);
    if (!point) continue;
    if (row.publication_type === "article") point.article = row.record_count;
    else point.preprint = row.record_count;
  }
  return [...points.values()];
}

function countFromRuns(runs: Array<IngestionRunRow | null>) {
  const successful = runs.filter((run): run is IngestionRunRow => Boolean(run && run.status !== "failed"));
  return successful.length ? successful.reduce((sum, run) => sum + run.found_count, 0) : null;
}

export async function readRadarData(
  db: D1DatabaseLike,
  options: { days: number; scope: "ai" | "field"; layers?: SearchLayer[] },
): Promise<RadarData> {
  const dashboardQueriedAt = new Date().toISOString();
  const layers = options.layers?.length ? [...new Set(options.layers)] : [...SEARCH_LAYERS];
  const [coreRun, broadRun, frontierOpenAlexRun, frontierArxivRun, trendRun, stateRow] = await Promise.all([
    latestRun(db, INGESTION_SOURCE_KEYS.core, "core", options.scope),
    latestRun(db, INGESTION_SOURCE_KEYS.broad, "broad", options.scope),
    latestRun(db, INGESTION_SOURCE_KEYS.frontier, "frontier", options.scope),
    latestRun(db, INGESTION_SOURCE_KEYS.arxiv, "frontier", options.scope),
    latestRun(db, INGESTION_SOURCE_KEYS.trends, "trends", "all"),
    first<{ run_count: number; last_ingestion_at: string | null }>(db, `
      SELECT
        (SELECT COUNT(*) FROM ingestion_runs) + (SELECT COUNT(*) FROM call_ingestion_runs) AS run_count,
        (SELECT MAX(value) FROM (
          SELECT MAX(ended_at) AS value FROM ingestion_runs
          UNION ALL
          SELECT MAX(ended_at) AS value FROM call_ingestion_runs
        )) AS last_ingestion_at
    `),
  ]);
  const layerRuns: Record<SearchLayer, Array<IngestionRunRow | null>> = {
    core: [coreRun],
    broad: [broadRun],
    frontier: [frontierOpenAlexRun, frontierArxivRun],
  };
  const [works, trend, callsData, trendAnalysis, quality] = await Promise.all([
    readWorks(db, options.scope, options.days, layers),
    readTrend(db, trendRun, options.scope),
    readCallsData(db, dashboardQueriedAt),
    readThemeSignalAnalysis(db, trendRun && trendRun.status !== "failed" ? trendRun.id : null, options.scope, dashboardQueriedAt),
    readDataQualityReport(db, options.scope, dashboardQueriedAt),
  ]);
  const questions = buildResearchQuestions(works);
  const themeAnalysis = buildThemeAnalysis(works);
  const layerStatus = {
    core: dataStatusFromRuns(layerRuns.core, "Core"),
    broad: dataStatusFromRuns(layerRuns.broad, "Broad"),
    frontier: dataStatusFromRuns(layerRuns.frontier, "Frontier"),
  };
  const selectedStatuses = layers.map((layer) => layerStatus[layer].status);
  const publicationsStatus = dataStatusFromRuns(layers.flatMap((layer) => layer === "frontier" ? [] : layerRuns[layer]), "Publikationen");
  const preprintsStatus = dataStatusFromRuns(layers.includes("frontier") ? layerRuns.frontier : [], "Preprints und Proceedings");
  const rawTrendsStatus = dataStatusFromRuns([trendRun], "Trenddaten");
  const trendsStatus: DatasetAvailability = {
    status: overallStatus([rawTrendsStatus.status, trendAnalysis.status.status]),
    error: [rawTrendsStatus.error, trendAnalysis.status.error].filter(Boolean).join(" ") || null,
  };
  const journalCount = countFromRuns(layers.flatMap((layer) => layer === "frontier" ? [] : layerRuns[layer]));
  const preprintCount = countFromRuns(layers.includes("frontier") ? layerRuns.frontier : []);
  const newestRetrievedAt = works.length
    ? (await first<{ retrieved_at: string | null }>(db, "SELECT MAX(retrieved_at) AS retrieved_at FROM work_versions WHERE is_current = 1"))?.retrieved_at ?? null
    : null;
  const dataSnapshotAt = [newestRetrievedAt, trendRun?.ended_at ?? null, trendAnalysis.snapshotAt, callsData.verifiedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    dashboardQueriedAt,
    newestPublicationDate: works.find((work) => Boolean(work.publicationDate))?.publicationDate ?? null,
    analysisVersion: ANALYSIS_VERSION,
    queryVersion: SEARCH_CONFIG_VERSION,
    cacheDurationSeconds: CACHE_DURATION_SECONDS,
    staleWhileRevalidateSeconds: STALE_WHILE_REVALIDATE_SECONDS,
    storage: {
      state: (stateRow?.run_count ?? 0) === 0 ? "empty" : "ready",
      lastIngestionAt: stateRow?.last_ingestion_at ?? null,
      dataSnapshotAt,
    },
    status: overallStatus([...selectedStatuses, trendsStatus.status, callsData.status.status]),
    dataStatus: { publications: publicationsStatus, preprints: preprintsStatus, trends: trendsStatus, calls: callsData.status },
    layerStatus,
    searchLayers: layers,
    availableSearchLayers: [...SEARCH_LAYERS],
    scope: options.scope,
    days: options.days,
    counts: {
      journal: journalCount,
      preprint: preprintCount,
      totalFound: (journalCount ?? 0) + (preprintCount ?? 0),
      totalFoundComplete: layers.every((layer) => layerStatus[layer].status === "live"),
      analyzed: works.length,
      displayed: works.length,
    },
    works,
    questions,
    themeAnalysis,
    trend,
    trendAnalysis,
    calls: callsData,
    quality,
    methodology: METHODOLOGY_MANIFEST,
    sources: {
      journals: JOURNALS,
      conferences: CORE_CONFERENCES,
      preprints: [...new Map(PREPRINT_SOURCES.map((source) => [source.name, source])).values()],
    },
    method: {
      psychologyField: "OpenAlex topics.field.id = 32 (Psychology; any of the top assigned topics)",
      aiTerms: AI_TERMS,
      humanTerms: HUMAN_AI_TERMS,
      fieldTerms: FIELD_TERMS,
      deduplication: "DOI, provider/source record ID, exact normalized title, then cautious title similarity with date and author safeguards; manifestations remain linked as versions.",
    },
  };
}

export async function getIngestionRun(db: D1DatabaseLike, id: string) {
  return first<IngestionRunRow>(db, `
    SELECT ir.*, s.key AS source_key FROM ingestion_runs ir
    JOIN sources s ON s.id = ir.source_id
    WHERE ir.id = ?
  `, [id]);
}
