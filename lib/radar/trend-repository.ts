import type { RadarThemeTrendSignal, RadarTrendAnalysis } from "@/app/radar-types";
import type { D1DatabaseLike, D1Value } from "@/db/d1";
import { readCallsData } from "../calls/repository";
import {
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY_VERSION,
} from "./config/themes.v2";
import {
  TREND_ANALYSIS_VERSION,
  TREND_COMPARISON_FIELD_LABELS,
  TREND_SNAPSHOT_VERSION,
} from "./config/trend-analysis.v1";
import {
  buildTrendAnalysis,
  latestStableCompleteYear,
  type TrendComparisonYear,
  type TrendPublicationRecord,
} from "./trend-analysis";

type TrendRecordRow = {
  record_id: string;
  year: number;
  version_type: TrendPublicationRecord["type"];
  venue: string;
  providers: string | null;
  themes: string;
};

type TrendSnapshotRow = {
  year: number;
  publication_type: "article" | "preprint";
  record_count: number;
};

type DiscoveryRunRow = {
  source_key: string;
  status: "running" | "succeeded" | "partial" | "failed";
  limit_reached: number;
};

type StoredSignalRow = {
  snapshot_json: string;
  captured_at: string;
};

const EXPECTED_DISCOVERY_SOURCES = ["openalex-core", "openalex-broad", "openalex-frontier", "arxiv-frontier"];

function statement(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  return values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);
}

async function all<T>(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  const result = await statement(db, sql, values).all<T>();
  return result.results ?? [];
}

async function readTrendRecords(db: D1DatabaseLike, scope: "ai" | "field", startYear: number, endYear: number) {
  const rows = await all<TrendRecordRow>(db, `
    SELECT
      v.id AS record_id,
      CAST(SUBSTR(v.publication_date, 1, 4) AS INTEGER) AS year,
      v.version_type,
      v.source_name AS venue,
      (SELECT GROUP_CONCAT(DISTINCT wd.provider) FROM work_discoveries wd WHERE wd.work_id = w.id) AS providers,
      GROUP_CONCAT(DISTINCT wt.theme) AS themes
    FROM works w
    JOIN work_scopes sc ON sc.work_id = w.id AND sc.scope = ?
    JOIN work_versions v ON v.work_id = w.id AND v.is_current = 1
    JOIN work_themes wt ON wt.work_id = w.id
      AND wt.classification_version = ? AND wt.ontology_version = ?
    WHERE v.publication_date IS NOT NULL
      AND CAST(SUBSTR(v.publication_date, 1, 4) AS INTEGER) BETWEEN ? AND ?
    GROUP BY v.id
    ORDER BY year, v.id
  `, [scope, THEME_CLASSIFICATION_VERSION, THEME_ONTOLOGY_VERSION, startYear, endYear]);
  return rows.map((row): TrendPublicationRecord => ({
    id: row.record_id,
    year: row.year,
    type: row.version_type,
    venue: row.venue,
    providers: row.providers?.split(",").filter(Boolean) ?? ["unknown"],
    themes: row.themes.split(",").filter(Boolean),
  }));
}

async function readComparison(db: D1DatabaseLike, ingestionRunId: string, scope: "ai" | "field") {
  const rows = await all<TrendSnapshotRow>(db, `
    SELECT year, publication_type, record_count
    FROM trend_snapshots
    WHERE ingestion_run_id = ? AND scope = ?
    ORDER BY year, publication_type
  `, [ingestionRunId, scope]);
  const byYear = new Map<number, TrendComparisonYear>();
  for (const row of rows) {
    const current = byYear.get(row.year) ?? { year: row.year, article: null, preprint: null };
    if (row.publication_type === "article") current.article = row.record_count;
    else current.preprint = row.record_count;
    byYear.set(row.year, current);
  }
  return [...byYear.values()].sort((left, right) => left.year - right.year);
}

async function readDiscoveryQuality(db: D1DatabaseLike, scope: "ai" | "field") {
  const rows = await all<DiscoveryRunRow>(db, `
    WITH ranked AS (
      SELECT s.key AS source_key, ir.status, ir.limit_reached,
        ROW_NUMBER() OVER (PARTITION BY s.key ORDER BY ir.started_at DESC) AS position
      FROM ingestion_runs ir
      JOIN sources s ON s.id = ir.source_id
      WHERE ir.scope = ? AND ir.search_layer IN ('core', 'broad', 'frontier')
    )
    SELECT source_key, status, limit_reached FROM ranked WHERE position = 1
  `, [scope]);
  const bySource = new Map(rows.map((row) => [row.source_key, row]));
  const missing = EXPECTED_DISCOVERY_SOURCES.filter((source) => !bySource.has(source));
  const incomplete = rows.filter((row) => row.status !== "succeeded" || Boolean(row.limit_reached));
  return {
    complete: missing.length === 0 && incomplete.length === 0,
    issues: [
      ...(missing.length ? [`Fehlende Discovery-Läufe: ${missing.join(", ")}.`] : []),
      ...(incomplete.length ? [`Partielle oder begrenzte Discovery-Läufe: ${incomplete.map((row) => row.source_key).join(", ")}.`] : []),
    ],
  };
}

function denominatorComplete(comparison: TrendComparisonYear[], startYear: number, endYear: number) {
  const selected = comparison.filter((year) => year.year >= startYear && year.year <= endYear);
  return selected.length === endYear - startYear + 1 && selected.every((year) => year.article !== null && year.preprint !== null);
}

export async function createThemeSignalSnapshots(
  db: D1DatabaseLike,
  input: { ingestionRunId: string; capturedAt: string },
) {
  const currentYear = new Date(input.capturedAt).getUTCFullYear();
  const calls = await readCallsData(db, input.capturedAt);
  const agenda = calls.agendaSignals.map((signal) => ({
    theme: signal.theme,
    activeCalls: signal.count,
    closingCalls: signal.closingCount,
  }));
  const analyses: RadarTrendAnalysis[] = [];
  for (const scope of ["ai", "field"] as const) {
    const [records, comparison, discovery] = await Promise.all([
      readTrendRecords(db, scope, currentYear - 10, currentYear),
      readComparison(db, input.ingestionRunId, scope),
      readDiscoveryQuality(db, scope),
    ]);
    const stableEndYear = latestStableCompleteYear(input.capturedAt);
    const analysis = buildTrendAnalysis({
      records,
      comparison,
      agenda,
      scope,
      capturedAt: input.capturedAt,
      corpusComplete: discovery.complete,
      denominatorComplete: denominatorComplete(comparison, stableEndYear - 7, stableEndYear),
      callsAvailable: calls.status.status === "live",
      additionalQualityIssues: discovery.issues,
    });
    analyses.push(analysis);
    await db.batch(analysis.themes.map((theme) => statement(db, `
      INSERT INTO theme_signal_snapshots (
        id, ingestion_run_id, scope, theme, snapshot_version, analysis_version,
        captured_at, stable_end_year, quality_status, absolute_count, per_thousand,
        journal_count, preprint_count, short_growth_percent, long_growth_percent,
        acceleration_percentage_points, source_count, venue_count, active_call_count,
        opportunity_score, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [crypto.randomUUID(), input.ingestionRunId, scope, theme.theme, theme.snapshotVersion,
      theme.analysisVersion, theme.capturedAt, theme.stableEndYear, theme.dataQuality.status,
      theme.windows.shortRecent.absoluteCount, theme.windows.shortRecent.perThousand,
      theme.windows.shortRecent.journalCount, theme.windows.shortRecent.preprintCount,
      theme.shortGrowthPercent, theme.longGrowthPercent, theme.accelerationPercentagePoints,
      theme.diversity.sourceCount, theme.diversity.venueCount, theme.agendaSignal.activeCalls,
      theme.opportunity.score, JSON.stringify(theme)])));
  }
  return analyses;
}

function parsedSignals(rows: StoredSignalRow[]) {
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.snapshot_json) as RadarThemeTrendSignal;
      return parsed.snapshotVersion === TREND_SNAPSHOT_VERSION && parsed.analysisVersion === TREND_ANALYSIS_VERSION ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export async function readThemeSignalAnalysis(
  db: D1DatabaseLike,
  ingestionRunId: string | null,
  scope: "ai" | "field",
  now: string,
): Promise<RadarTrendAnalysis> {
  const empty = buildTrendAnalysis({
    records: [], comparison: [], agenda: [], scope, capturedAt: now,
    corpusComplete: false, denominatorComplete: false, callsAvailable: false,
  });
  if (!ingestionRunId) return { ...empty, snapshotAt: null, themes: [] };
  const rows = await all<StoredSignalRow>(db, `
    SELECT snapshot_json, captured_at
    FROM theme_signal_snapshots
    WHERE ingestion_run_id = ? AND scope = ?
    ORDER BY theme
  `, [ingestionRunId, scope]);
  const themes = parsedSignals(rows);
  if (themes.length === 0) return { ...empty, snapshotAt: null, themes: [] };
  const snapshotAt = rows[0].captured_at;
  const allSufficient = themes.every((theme) => theme.dataQuality.status === "sufficient");
  return {
    ...empty,
    status: allSufficient
      ? { status: "live", error: null }
      : { status: "partial", error: "Trend- und Opportunity-Analyse: Mindestens ein Themencluster weist begrenzte oder unzureichende Datenqualität auf." },
    snapshotAt,
    currentYear: new Date(snapshotAt).getUTCFullYear(),
    latestStableYear: themes[0].stableEndYear,
    excludedForIndexingLag: themes[0].stableEndYear < new Date(snapshotAt).getUTCFullYear() - 1
      ? [new Date(snapshotAt).getUTCFullYear() - 1]
      : [],
    themes,
    comparisonField: TREND_COMPARISON_FIELD_LABELS[scope],
  };
}
