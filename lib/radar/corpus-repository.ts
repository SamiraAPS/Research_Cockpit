import type {
  CorpusMode,
  CorpusSort,
  RadarCorpusFacet,
  RadarCorpusResponse,
  RadarCorpusWork,
  RadarThemeClassification,
  SearchLayer,
} from "@/app/radar-types";
import type { D1DatabaseLike, D1Value } from "@/db/d1";
import { buildRadarWork, SEARCH_LAYERS } from "./config";
import {
  findThemeDefinition,
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY_VERSION,
  THEME_SCORE_THRESHOLD,
} from "./config/themes.v2";
import type { WorkVersionType } from "./work";

export type CorpusSearchOptions = {
  scope: "ai" | "field";
  page?: number;
  pageSize?: number;
  query?: string;
  layer?: SearchLayer | null;
  venueKind?: RadarCorpusWork["sourceKind"] | null;
  venue?: string | null;
  theme?: string | null;
  publicationType?: WorkVersionType | null;
  fromYear?: number | null;
  toYear?: number | null;
  workDomain?: string | null;
  sort?: CorpusSort;
  mode?: CorpusMode;
  ids?: string[];
  includeFacets?: boolean;
};

type SuccessfulRunRow = {
  id: string;
  source_name: string;
  search_layer: SearchLayer;
  started_at: string;
  ended_at: string;
  new_count: number;
};

type CorpusRow = {
  work_id: string;
  version_type: WorkVersionType;
  title: string;
  abstract: string | null;
  authors_json: string;
  doi_normalized: string | null;
  source_name: string;
  publication_date: string | null;
  online_date: string | null;
  url: string;
  is_open_access: number;
  open_access_status: string | null;
  cited_by_count: number;
  topics_json: string;
  keywords_json: string;
  retrieved_at: string;
  first_seen_at: string;
  ingestion_status: RadarCorpusWork["ingestionStatus"];
  theme_classifications: string | null;
  search_layers: string | null;
  emerging_rank: number | null;
};

type CountRow = { count: number };
type VenueFacetRow = { value: string; kind: RadarCorpusWork["sourceKind"]; count: number };
type FacetRow = { value: string; count: number };

const RANKED_VERSIONS_CTE = `
  ranked_versions AS (
    SELECT v.*, ir.status AS ingestion_status,
      ROW_NUMBER() OVER (
        PARTITION BY v.work_id
        ORDER BY CASE v.version_type WHEN 'journal' THEN 3 WHEN 'proceedings' THEN 2 ELSE 1 END DESC,
          COALESCE(v.publication_date, '') DESC, v.retrieved_at DESC
      ) AS version_rank
    FROM work_versions v
    JOIN ingestion_runs ir ON ir.id = v.ingestion_run_id
    WHERE v.is_current = 1
  ),
  preferred_versions AS (
    SELECT * FROM ranked_versions WHERE version_rank = 1
  )
`;

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

function parseJsonArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseAuthors(value: string) {
  try {
    const parsed = JSON.parse(value) as Array<{ name?: unknown }>;
    return parsed.flatMap((author) => typeof author?.name === "string" ? [author.name] : []).slice(0, 4);
  } catch {
    return [];
  }
}

function parseThemeClassifications(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<{
      theme?: unknown;
      score?: unknown;
      classificationVersion?: unknown;
      ontologyVersion?: unknown;
      evidence?: unknown;
    }>;
    return parsed.flatMap((item): RadarThemeClassification[] => {
      if (typeof item.theme !== "string" || typeof item.score !== "number" ||
          typeof item.classificationVersion !== "string" || typeof item.ontologyVersion !== "string" ||
          !Array.isArray(item.evidence)) return [];
      const definition = findThemeDefinition(item.theme);
      return [{
        theme: item.theme,
        label: definition?.label ?? item.theme,
        score: item.score,
        classificationVersion: item.classificationVersion,
        ontologyVersion: item.ontologyVersion,
        evidence: item.evidence as RadarThemeClassification["evidence"],
      }];
    }).filter((classification) =>
      classification.classificationVersion === THEME_CLASSIFICATION_VERSION &&
      classification.ontologyVersion === THEME_ONTOLOGY_VERSION &&
      classification.score >= THEME_SCORE_THRESHOLD
    ).sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme));
  } catch {
    return [];
  }
}

function sourceKind(type: WorkVersionType): RadarCorpusWork["sourceKind"] {
  return type === "journal" ? "journal" : type === "proceedings" ? "conference" : "repository";
}

function emergingStatus(rank: number): RadarCorpusWork["emergingSignal"]["status"] {
  if (rank >= 4) return "burst";
  if (rank === 3) return "rising";
  if (rank === 2) return "stable";
  if (rank === 1) return "cooling";
  return "insufficient";
}

function dataStatus(status: RadarCorpusWork["ingestionStatus"]): RadarCorpusWork["dataStatus"] {
  if (status === "succeeded") return "live";
  if (status === "partial" || status === "running") return "partial";
  return "unavailable";
}

function mapCorpusRow(row: CorpusRow): RadarCorpusWork {
  const themeClassifications = parseThemeClassifications(row.theme_classifications);
  const work = buildRadarWork({
    id: row.work_id,
    title: row.title,
    publicationDate: row.publication_date ?? "",
    source: row.source_name,
    sourceType: row.version_type,
    searchLayers: row.search_layers?.split(",").filter((layer): layer is SearchLayer => SEARCH_LAYERS.includes(layer as SearchLayer)) ?? [],
    authors: parseAuthors(row.authors_json),
    citedBy: row.cited_by_count,
    url: row.url,
    isOpenAccess: Boolean(row.is_open_access),
    themes: themeClassifications.map((classification) => classification.theme),
    themeClassifications,
  });
  const rank = Number(row.emerging_rank ?? 0);
  return {
    ...work,
    abstract: row.abstract,
    doi: row.doi_normalized,
    onlineDate: row.online_date,
    openAccessStatus: row.open_access_status,
    topics: parseJsonArray(row.topics_json),
    keywords: parseJsonArray(row.keywords_json),
    retrievedAt: row.retrieved_at,
    firstSeenAt: row.first_seen_at,
    sourceKind: sourceKind(row.version_type),
    dataStatus: dataStatus(row.ingestion_status),
    ingestionStatus: row.ingestion_status,
    emergingSignal: { rank, status: emergingStatus(rank) },
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function latestSuccessfulRun(db: D1DatabaseLike, scope: "ai" | "field") {
  return first<SuccessfulRunRow>(db, `
    SELECT ir.id, s.name AS source_name, ir.search_layer, ir.started_at, ir.ended_at, ir.new_count
    FROM ingestion_runs ir
    JOIN sources s ON s.id = ir.source_id
    WHERE ir.scope = ? AND ir.search_layer IN ('core', 'broad', 'frontier')
      AND ir.status = 'succeeded' AND ir.ended_at IS NOT NULL
    ORDER BY ir.ended_at DESC, ir.id DESC
    LIMIT 1
  `, [scope]);
}

function utcWeek(iso: string) {
  const anchor = new Date(iso);
  const day = anchor.getUTCDay() || 7;
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - day + 1));
  const end = new Date(start.getTime() + 7 * 86_400_000 - 1);
  return { anchorAt: iso, startAt: start.toISOString(), endAt: end.toISOString() };
}

function buildConditions(
  options: CorpusSearchOptions,
  run: SuccessfulRunRow | null,
  weeklyWindow: ReturnType<typeof utcWeek> | null,
) {
  const conditions = ["sc.scope = ?"];
  const values: D1Value[] = [options.scope];
  const query = options.query?.trim();
  if (query) {
    conditions.push(`LOWER(v.title || ' ' || COALESCE(v.abstract, '') || ' ' || v.authors_json || ' ' || v.source_name || ' ' || COALESCE(v.doi_normalized, '')) LIKE ? ESCAPE '\\'`);
    values.push(`%${escapeLike(query.toLocaleLowerCase("de"))}%`);
  }
  if (options.layer) {
    conditions.push("EXISTS (SELECT 1 FROM work_discoveries wd WHERE wd.work_id = w.id AND wd.search_layer = ?)");
    values.push(options.layer);
  }
  if (options.venueKind) {
    const versionType = options.venueKind === "journal" ? "journal" : options.venueKind === "conference" ? "proceedings" : "preprint";
    conditions.push("v.version_type = ?");
    values.push(versionType);
  }
  if (options.venue) {
    conditions.push("v.source_name = ?");
    values.push(options.venue);
  }
  if (options.theme) {
    conditions.push("EXISTS (SELECT 1 FROM work_themes wt_filter WHERE wt_filter.work_id = w.id AND wt_filter.theme = ? AND wt_filter.classification_version = ? AND wt_filter.ontology_version = ? AND wt_filter.score >= ?)");
    values.push(options.theme, THEME_CLASSIFICATION_VERSION, THEME_ONTOLOGY_VERSION, THEME_SCORE_THRESHOLD);
  }
  if (options.publicationType) {
    conditions.push("v.version_type = ?");
    values.push(options.publicationType);
  }
  if (options.fromYear) {
    conditions.push("v.publication_date >= ?");
    values.push(`${options.fromYear}-01-01`);
  }
  if (options.toYear) {
    conditions.push("v.publication_date <= ?");
    values.push(`${options.toYear}-12-31`);
  }
  if (options.workDomain) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(v.topics_json) domain WHERE LOWER(CAST(domain.value AS TEXT)) = LOWER(?))");
    values.push(options.workDomain);
  }
  if (options.mode === "new") {
    if (!run) conditions.push("1 = 0");
    else {
      conditions.push("w.created_at >= ? AND w.created_at <= ? AND EXISTS (SELECT 1 FROM work_discoveries wd_new WHERE wd_new.work_id = w.id AND wd_new.ingestion_run_id = ?)");
      values.push(run.started_at, run.ended_at, run.id);
    }
  }
  if (options.mode === "weekly") {
    if (!weeklyWindow) conditions.push("1 = 0");
    else {
      conditions.push("w.first_seen_at >= ? AND w.first_seen_at <= ?");
      values.push(weeklyWindow.startAt, weeklyWindow.endAt);
    }
  }
  if (options.mode === "shortlist" || options.ids?.length) {
    const ids = [...new Set(options.ids ?? [])].slice(0, 250);
    if (ids.length === 0) conditions.push("1 = 0");
    else {
      conditions.push(`w.id IN (${ids.map(() => "?").join(", ")})`);
      values.push(...ids);
    }
  }
  return { sql: conditions.join(" AND "), values };
}

const CITATION_FACTOR_SQL = `CASE
  WHEN v.cited_by_count >= 53 THEN 12 WHEN v.cited_by_count >= 38 THEN 11
  WHEN v.cited_by_count >= 26 THEN 10 WHEN v.cited_by_count >= 19 THEN 9
  WHEN v.cited_by_count >= 13 THEN 8 WHEN v.cited_by_count >= 9 THEN 7
  WHEN v.cited_by_count >= 6 THEN 6 WHEN v.cited_by_count >= 4 THEN 5
  WHEN v.cited_by_count >= 3 THEN 4 WHEN v.cited_by_count >= 2 THEN 3
  WHEN v.cited_by_count >= 1 THEN 2 ELSE 0 END`;

function orderBy(sort: CorpusSort) {
  if (sort === "citations") return "v.cited_by_count DESC, COALESCE(v.publication_date, '') DESC, w.id";
  if (sort === "relevance") return "relevance_sort DESC, COALESCE(v.publication_date, '') DESC, w.id";
  if (sort === "emerging") return "COALESCE(sr.emerging_rank, 0) DESC, relevance_sort DESC, COALESCE(v.publication_date, '') DESC, w.id";
  return "COALESCE(v.publication_date, '') DESC, v.retrieved_at DESC, w.id";
}

async function readFacets(db: D1DatabaseLike, scope: "ai" | "field") {
  const [venues, themes, workDomains] = await Promise.all([
    all<VenueFacetRow>(db, `WITH ${RANKED_VERSIONS_CTE}
      SELECT v.source_name AS value,
        CASE v.version_type WHEN 'journal' THEN 'journal' WHEN 'proceedings' THEN 'conference' ELSE 'repository' END AS kind,
        COUNT(DISTINCT w.id) AS count
      FROM works w
      JOIN work_scopes sc ON sc.work_id = w.id AND sc.scope = ?
      JOIN preferred_versions v ON v.work_id = w.id
      GROUP BY v.source_name, kind
      ORDER BY count DESC, value
      LIMIT 150`, [scope]),
    all<FacetRow>(db, `WITH ${RANKED_VERSIONS_CTE}
      SELECT wt.theme AS value, COUNT(DISTINCT w.id) AS count
      FROM works w
      JOIN work_scopes sc ON sc.work_id = w.id AND sc.scope = ?
      JOIN preferred_versions v ON v.work_id = w.id
      JOIN work_themes wt ON wt.work_id = w.id
      WHERE wt.classification_version = ? AND wt.ontology_version = ? AND wt.score >= ?
      GROUP BY wt.theme ORDER BY count DESC, value`, [scope, THEME_CLASSIFICATION_VERSION, THEME_ONTOLOGY_VERSION, THEME_SCORE_THRESHOLD]),
    all<FacetRow>(db, `WITH ${RANKED_VERSIONS_CTE}
      SELECT CAST(domain.value AS TEXT) AS value, COUNT(DISTINCT w.id) AS count
      FROM works w
      JOIN work_scopes sc ON sc.work_id = w.id AND sc.scope = ?
      JOIN preferred_versions v ON v.work_id = w.id
      JOIN json_each(v.topics_json) domain
      WHERE TRIM(CAST(domain.value AS TEXT)) <> ''
      GROUP BY value ORDER BY count DESC, value
      LIMIT 40`, [scope]),
  ]);
  return {
    venues: venues.map((facet) => ({ ...facet, label: facet.value })),
    themes: themes.map((facet) => ({ ...facet, label: findThemeDefinition(facet.value)?.label ?? facet.value })),
    workDomains: workDomains.map((facet) => ({ ...facet, label: facet.value })),
    studyTypes: [] as RadarCorpusFacet[],
    studyTypeDataAvailable: false,
  };
}

export async function searchCorpus(db: D1DatabaseLike, options: CorpusSearchOptions): Promise<RadarCorpusResponse> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 5_000);
  const page = Math.max(options.page ?? 1, 1);
  const mode = options.mode ?? "all";
  const run = await latestSuccessfulRun(db, options.scope);
  const weeklyWindow = run ? utcWeek(run.ended_at) : null;
  const effectiveSort = mode === "weekly" ? "relevance" : options.sort ?? "date";
  const conditions = buildConditions({ ...options, mode }, run, weeklyWindow);
  const totalRow = await first<CountRow>(db, `WITH ${RANKED_VERSIONS_CTE}
    SELECT COUNT(DISTINCT w.id) AS count
    FROM works w
    JOIN work_scopes sc ON sc.work_id = w.id
    JOIN preferred_versions v ON v.work_id = w.id
    WHERE ${conditions.sql}`, conditions.values);
  const total = Number(totalRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const rows = await all<CorpusRow>(db, `WITH ${RANKED_VERSIONS_CTE},
    current_signals AS (
      SELECT theme, snapshot_json
      FROM theme_signal_snapshots
      WHERE scope = ? AND captured_at = (SELECT MAX(captured_at) FROM theme_signal_snapshots WHERE scope = ?)
    ),
    signal_ranks AS (
      SELECT wt.work_id, MAX(CASE json_extract(cs.snapshot_json, '$.emergingSignal.status')
        WHEN 'burst' THEN 4 WHEN 'rising' THEN 3 WHEN 'stable' THEN 2 WHEN 'cooling' THEN 1 ELSE 0 END) AS emerging_rank
      FROM work_themes wt
      LEFT JOIN current_signals cs ON cs.theme = wt.theme
      GROUP BY wt.work_id
    )
    SELECT
      w.id AS work_id, v.version_type, v.title, v.abstract, v.authors_json, v.doi_normalized,
      v.source_name, v.publication_date, v.online_date, v.url, v.is_open_access,
      v.open_access_status, v.cited_by_count, v.topics_json, v.keywords_json,
      v.retrieved_at, w.first_seen_at, v.ingestion_status,
      (SELECT json_group_array(json_object(
        'theme', wt.theme, 'score', wt.score,
        'classificationVersion', wt.classification_version,
        'ontologyVersion', wt.ontology_version,
        'evidence', json(wt.evidence_json)
      )) FROM work_themes wt WHERE wt.work_id = w.id) AS theme_classifications,
      (SELECT GROUP_CONCAT(DISTINCT wd.search_layer) FROM work_discoveries wd WHERE wd.work_id = w.id) AS search_layers,
      COALESCE(sr.emerging_rank, 0) AS emerging_rank,
      MIN(99, 48 + COALESCE((SELECT SUM(CASE wt_score.theme
        WHEN 'learning' THEN 16 WHEN 'agency' THEN 16 WHEN 'motivation' THEN 16
        WHEN 'cognition' THEN 13 WHEN 'teaming' THEN 13 ELSE 9 END)
        FROM work_themes wt_score
        WHERE wt_score.work_id = w.id AND wt_score.classification_version = ?
          AND wt_score.ontology_version = ? AND wt_score.score >= ?), 0) + ${CITATION_FACTOR_SQL}) AS relevance_sort
    FROM works w
    JOIN work_scopes sc ON sc.work_id = w.id
    JOIN preferred_versions v ON v.work_id = w.id
    LEFT JOIN signal_ranks sr ON sr.work_id = w.id
    WHERE ${conditions.sql}
    ORDER BY ${orderBy(effectiveSort)}
    LIMIT ? OFFSET ?`, [options.scope, options.scope, THEME_CLASSIFICATION_VERSION, THEME_ONTOLOGY_VERSION, THEME_SCORE_THRESHOLD, ...conditions.values, pageSize, offset]);

  const facets = options.includeFacets === false
    ? { venues: [], themes: [], workDomains: [], studyTypes: [], studyTypeDataAvailable: false }
    : await readFacets(db, options.scope);
  const hasCorpus = total > 0 || Boolean(run);
  return {
    status: hasCorpus
      ? { status: "live", error: null }
      : { status: "unavailable", error: "Noch kein erfolgreicher Publikations-Ingestion-Lauf vorhanden." },
    queriedAt: new Date().toISOString(),
    mode,
    scope: options.scope,
    items: rows.map(mapCorpusRow),
    pagination: { page: safePage, pageSize, total, totalPages },
    facets,
    latestSuccessfulRun: run ? {
      id: run.id,
      source: run.source_name,
      searchLayer: run.search_layer,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      newCount: run.new_count,
    } : null,
    weeklyWindow,
  };
}

export async function readUserShortlist(db: D1DatabaseLike, userId: string) {
  return all<{ work_id: string; updated_at: string }>(db, `
    SELECT work_id, updated_at FROM user_shortlist_items
    WHERE user_id = ? ORDER BY created_at DESC, work_id
  `, [userId]);
}

export async function addUserShortlistItem(db: D1DatabaseLike, userId: string, workId: string, now = new Date().toISOString()) {
  const exists = await first<{ id: string }>(db, "SELECT id FROM works WHERE id = ?", [workId]);
  if (!exists) return false;
  await statement(db, `
    INSERT INTO user_shortlist_items (user_id, work_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, work_id) DO UPDATE SET updated_at = excluded.updated_at
  `, [userId, workId, now, now]).run();
  return true;
}

export async function removeUserShortlistItem(db: D1DatabaseLike, userId: string, workId: string) {
  await statement(db, "DELETE FROM user_shortlist_items WHERE user_id = ? AND work_id = ?", [userId, workId]).run();
}
