import type { RadarDataQualityReport, RadarDataQualityWarning, SearchLayer } from "@/app/radar-types";
import type { D1DatabaseLike, D1Value } from "@/db/d1";
import { DATA_QUALITY_THRESHOLDS, DATA_QUALITY_VERSION } from "./config/data-quality.v1";

type QualityRunRow = {
  id: string;
  source_id: number;
  source_name: string;
  source_key: string;
  scope: "ai" | "field" | "all";
  search_layer: SearchLayer | "trends";
  status: "succeeded" | "partial" | "failed";
  ended_at: string;
  found_count: number;
  loaded_count: number;
  new_count: number;
  updated_count: number;
  limit_reached: number;
};

type AbstractCoverageRow = { total_count: number; missing_count: number };

function statement(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  return values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);
}

async function all<T>(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  const result = await statement(db, sql, values).all<T>();
  return result.results ?? [];
}

async function first<T>(db: D1DatabaseLike, sql: string, values: D1Value[] = []) {
  return statement(db, sql, values).first<T>();
}

function warning(
  run: QualityRunRow,
  check: RadarDataQualityWarning["check"],
  severity: RadarDataQualityWarning["severity"],
  metric: number | null,
  threshold: number | null,
  message: string,
): RadarDataQualityWarning {
  return {
    id: `${run.id}:${check}`,
    check,
    severity,
    source: run.source_name,
    searchLayer: run.search_layer,
    ingestionRunId: run.id,
    metric,
    threshold,
    message,
  };
}

function elapsedHours(from: string, to: string) {
  const milliseconds = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds / 3_600_000) : 0;
}

async function abstractCoverage(db: D1DatabaseLike, runId: string) {
  return first<AbstractCoverageRow>(db, `
    SELECT COUNT(*) AS total_count,
      SUM(CASE WHEN has_abstract = 0 THEN 1 ELSE 0 END) AS missing_count
    FROM (
      SELECT wd.work_id,
        MAX(CASE WHEN NULLIF(TRIM(v.abstract), '') IS NOT NULL THEN 1 ELSE 0 END) AS has_abstract
      FROM work_discoveries wd
      LEFT JOIN work_versions v ON v.work_id = wd.work_id AND v.is_current = 1
      WHERE wd.ingestion_run_id = ?
      GROUP BY wd.work_id
    ) discovered
  `, [runId]);
}

export async function readDataQualityReport(
  db: D1DatabaseLike,
  scope: "ai" | "field",
  generatedAt = new Date().toISOString(),
): Promise<RadarDataQualityReport> {
  const rows = await all<QualityRunRow>(db, `
    SELECT ir.id, ir.source_id, s.name AS source_name, s.key AS source_key,
      ir.scope, ir.search_layer, ir.status, ir.ended_at, ir.found_count,
      ir.loaded_count, ir.new_count, ir.updated_count, ir.limit_reached
    FROM ingestion_runs ir
    JOIN sources s ON s.id = ir.source_id
    WHERE ir.ended_at IS NOT NULL AND ir.status != 'running'
      AND (ir.scope = ? OR (ir.scope = 'all' AND ir.search_layer = 'trends'))
    ORDER BY ir.source_id, ir.search_layer, ir.scope, ir.ended_at DESC, ir.started_at DESC
  `, [scope]);

  const grouped = new Map<string, QualityRunRow[]>();
  for (const row of rows) {
    const key = `${row.source_id}:${row.search_layer}:${row.scope}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const latestRuns = [...grouped.values()].flatMap((group) => group[0] ? [group[0]] : []);
  const warnings: RadarDataQualityWarning[] = [];

  for (const group of grouped.values()) {
    const current = group[0];
    if (!current) continue;
    const previous = group.slice(1).find((run) => run.status !== "failed");
    if (current.status === "failed") {
      warnings.push(warning(current, "source_unavailable", "error", null, null, `${current.source_name}: Der jüngste Quellenlauf ist vollständig fehlgeschlagen.`));
    } else if (current.status === "partial") {
      warnings.push(warning(current, "source_partial", "warning", null, null, `${current.source_name}: Der jüngste Quellenlauf war nur teilweise erfolgreich.`));
    }
    if (current.status !== "failed" && current.found_count === 0) {
      warnings.push(warning(current, "unexpected_zero_hits", "warning", 0, null, `${current.source_name}: Der Lauf lieferte unerwartet null Treffer.`));
    }
    if (current.status !== "failed" && previous && !current.limit_reached && !previous.limit_reached && previous.found_count > 0) {
      const decline = Math.round((1 - current.found_count / previous.found_count) * 1000) / 10;
      if (decline > DATA_QUALITY_THRESHOLDS.sourceDeclinePercent) {
        warnings.push(warning(current, "source_decline", "warning", decline, DATA_QUALITY_THRESHOLDS.sourceDeclinePercent, `${current.source_name}: Die Trefferzahl liegt ${decline.toLocaleString("de-CH")} % unter dem vorherigen vergleichbaren Lauf.`));
      }
    }
    if (current.status !== "failed" && current.loaded_count > 0) {
      const duplicateCount = Math.max(0, current.loaded_count - current.new_count - current.updated_count);
      const duplicateShare = Math.round(duplicateCount / current.loaded_count * 1000) / 10;
      if (duplicateShare > DATA_QUALITY_THRESHOLDS.duplicateSharePercent) {
        warnings.push(warning(current, "high_duplicate_share", "warning", duplicateShare, DATA_QUALITY_THRESHOLDS.duplicateSharePercent, `${current.source_name}: ${duplicateShare.toLocaleString("de-CH")} % der geladenen Datensätze waren bereits unverändert vorhanden.`));
      }
    }
    if (current.status !== "failed" && current.search_layer !== "trends") {
      const coverage = await abstractCoverage(db, current.id);
      const total = Number(coverage?.total_count ?? 0);
      const missing = Number(coverage?.missing_count ?? 0);
      const missingShare = total > 0 ? Math.round(missing / total * 1000) / 10 : 0;
      if (total > 0 && missingShare > DATA_QUALITY_THRESHOLDS.missingAbstractSharePercent) {
        warnings.push(warning(current, "missing_abstracts", "warning", missingShare, DATA_QUALITY_THRESHOLDS.missingAbstractSharePercent, `${current.source_name}: Bei ${missingShare.toLocaleString("de-CH")} % der entdeckten Werke fehlt ein Abstract.`));
      }
    }
    const ageHours = Math.round(elapsedHours(current.ended_at, generatedAt) * 10) / 10;
    if (ageHours > DATA_QUALITY_THRESHOLDS.staleRunHours) {
      warnings.push(warning(current, "stale_ingestion_run", "warning", ageHours, DATA_QUALITY_THRESHOLDS.staleRunHours, `${current.source_name}: Der jüngste abgeschlossene Lauf ist älter als ${DATA_QUALITY_THRESHOLDS.staleRunHours / 24} Tage.`));
    }
  }

  const discoveryRuns = latestRuns.filter((run) => run.search_layer !== "trends");
  const status = discoveryRuns.length === 0 || discoveryRuns.every((run) => run.status === "failed")
    ? "unavailable"
    : warnings.length > 0
      ? "partial"
      : "live";
  warnings.sort((left, right) => Number(right.severity === "error") - Number(left.severity === "error") || left.source.localeCompare(right.source) || left.check.localeCompare(right.check));
  return {
    version: DATA_QUALITY_VERSION,
    generatedAt,
    status,
    thresholds: { ...DATA_QUALITY_THRESHOLDS },
    checkedRunCount: latestRuns.length,
    warnings,
  };
}
