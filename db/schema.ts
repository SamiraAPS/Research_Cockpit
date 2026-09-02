import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<"provider" | "journal" | "conference" | "repository" | "organization" | "publisher">().notNull(),
  externalId: text("external_id"),
  area: text("area"),
  homepageUrl: text("homepage_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sources_key_unique").on(table.key),
  index("idx_sources_kind").on(table.kind),
  index("idx_sources_external_id").on(table.externalId),
]);

export const ingestionRuns = sqliteTable("ingestion_runs", {
  id: text("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  scope: text("scope").$type<"ai" | "field" | "all">().notNull(),
  searchLayer: text("search_layer").$type<"core" | "broad" | "frontier" | "trends">().notNull().default("core"),
  status: text("status").$type<"running" | "succeeded" | "partial" | "failed">().notNull(),
  queryVersion: text("query_version").notNull(),
  safetyLimit: integer("safety_limit").notNull().default(5000),
  limitReached: integer("limit_reached", { mode: "boolean" }).notNull().default(false),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  foundCount: integer("found_count").notNull().default(0),
  loadedCount: integer("loaded_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_ingestion_runs_source_scope_started").on(table.sourceId, table.scope, table.startedAt),
  index("idx_ingestion_runs_status_started").on(table.status, table.startedAt),
]);

export const works = sqliteTable("works", {
  id: text("id").primaryKey(),
  primaryDoi: text("primary_doi"),
  doiNormalized: text("doi_normalized"),
  primaryOpenAlexId: text("primary_openalex_id"),
  normalizedTitle: text("normalized_title").notNull(),
  createdAt: text("created_at").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  uniqueIndex("idx_works_doi_unique").on(table.doiNormalized).where(sql`${table.doiNormalized} IS NOT NULL`),
  uniqueIndex("idx_works_openalex_unique").on(table.primaryOpenAlexId).where(sql`${table.primaryOpenAlexId} IS NOT NULL`),
  index("idx_works_normalized_title").on(table.normalizedTitle),
  index("idx_works_last_seen").on(table.lastSeenAt),
  index("idx_works_first_seen").on(table.firstSeenAt),
]);

export const workVersions = sqliteTable("work_versions", {
  id: text("id").primaryKey(),
  workId: text("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
  ingestionRunId: text("ingestion_run_id").notNull().references(() => ingestionRuns.id, { onDelete: "restrict" }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  contentHash: text("content_hash").notNull(),
  versionType: text("version_type").$type<"journal" | "preprint" | "proceedings">().notNull(),
  title: text("title").notNull(),
  abstract: text("abstract"),
  authorsJson: text("authors_json").notNull(),
  doi: text("doi"),
  doiNormalized: text("doi_normalized"),
  openAlexId: text("openalex_id"),
  sourceRecordId: text("source_record_id"),
  sourceName: text("source_name").notNull(),
  publicationDate: text("publication_date"),
  onlineDate: text("online_date"),
  url: text("url").notNull(),
  isOpenAccess: integer("is_open_access", { mode: "boolean" }).notNull(),
  openAccessStatus: text("open_access_status"),
  citedByCount: integer("cited_by_count").notNull().default(0),
  topicsJson: text("topics_json").notNull(),
  keywordsJson: text("keywords_json").notNull(),
  retrievedAt: text("retrieved_at").notNull(),
  createdAt: text("created_at").notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
}, (table) => [
  uniqueIndex("idx_work_versions_content_unique").on(table.workId, table.versionType, table.contentHash),
  uniqueIndex("idx_work_versions_current_type_unique").on(table.workId, table.versionType).where(sql`${table.isCurrent} = 1`),
  index("idx_work_versions_current_date").on(table.isCurrent, table.publicationDate),
  index("idx_work_versions_current_source").on(table.isCurrent, table.sourceName),
  index("idx_work_versions_current_citations").on(table.isCurrent, table.citedByCount),
  index("idx_work_versions_run").on(table.ingestionRunId),
]);

export const workSources = sqliteTable("work_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workId: text("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  doiNormalized: text("doi_normalized"),
  openAlexId: text("openalex_id"),
  sourceRecordId: text("source_record_id").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  uniqueIndex("idx_work_sources_openalex_unique").on(table.openAlexId).where(sql`${table.openAlexId} IS NOT NULL`),
  index("idx_work_sources_doi").on(table.doiNormalized),
  uniqueIndex("idx_work_sources_record_unique").on(table.sourceId, table.sourceRecordId),
  index("idx_work_sources_work").on(table.workId),
]);

export const workDiscoveries = sqliteTable("work_discoveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workId: text("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
  ingestionRunId: text("ingestion_run_id").notNull().references(() => ingestionRuns.id, { onDelete: "restrict" }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  provider: text("provider").$type<"openalex" | "arxiv">().notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  searchLayer: text("search_layer").$type<"core" | "broad" | "frontier">().notNull(),
  queryVersion: text("query_version").notNull(),
  discoveredAt: text("discovered_at").notNull(),
}, (table) => [
  uniqueIndex("idx_work_discoveries_hit_unique").on(table.ingestionRunId, table.provider, table.sourceRecordId, table.searchLayer),
  index("idx_work_discoveries_work_layer").on(table.workId, table.searchLayer),
  index("idx_work_discoveries_run").on(table.ingestionRunId),
]);

export const workThemes = sqliteTable("work_themes", {
  workId: text("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
  theme: text("theme").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  classificationVersion: text("classification_version").notNull().default("weighted-lexical-2.0.0"),
  ontologyVersion: text("ontology_version").notNull().default("human-work-themes-2.0.0"),
  score: integer("score").notNull().default(0),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workId, table.theme] }),
  index("idx_work_themes_theme").on(table.theme),
]);

export const workScopes = sqliteTable("work_scopes", {
  workId: text("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
  scope: text("scope").$type<"ai" | "field">().notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workId, table.scope] }),
  index("idx_work_scopes_scope_last_seen").on(table.scope, table.lastSeenAt),
]);

export const trendSnapshots = sqliteTable("trend_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ingestionRunId: text("ingestion_run_id").notNull().references(() => ingestionRuns.id, { onDelete: "restrict" }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  scope: text("scope").notNull().default("all"),
  publicationType: text("publication_type").$type<"article" | "preprint">().notNull(),
  year: integer("year").notNull(),
  recordCount: integer("record_count").notNull(),
  capturedAt: text("captured_at").notNull(),
  queryVersion: text("query_version").notNull(),
}, (table) => [
  uniqueIndex("idx_trend_snapshots_run_series_unique").on(table.ingestionRunId, table.scope, table.publicationType, table.year),
  index("idx_trend_snapshots_source_captured").on(table.sourceId, table.capturedAt),
  index("idx_trend_snapshots_year_type").on(table.year, table.publicationType),
]);

export const themeSignalSnapshots = sqliteTable("theme_signal_snapshots", {
  id: text("id").primaryKey(),
  ingestionRunId: text("ingestion_run_id").notNull().references(() => ingestionRuns.id, { onDelete: "restrict" }),
  scope: text("scope").$type<"ai" | "field">().notNull(),
  theme: text("theme").notNull(),
  snapshotVersion: text("snapshot_version").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  capturedAt: text("captured_at").notNull(),
  stableEndYear: integer("stable_end_year").notNull(),
  qualityStatus: text("quality_status").$type<"sufficient" | "limited" | "insufficient" | "unavailable">().notNull(),
  absoluteCount: integer("absolute_count").notNull(),
  perThousand: real("per_thousand"),
  journalCount: integer("journal_count").notNull(),
  preprintCount: integer("preprint_count").notNull(),
  shortGrowthPercent: real("short_growth_percent"),
  longGrowthPercent: real("long_growth_percent"),
  accelerationPercentagePoints: real("acceleration_percentage_points"),
  sourceCount: integer("source_count").notNull(),
  venueCount: integer("venue_count").notNull(),
  activeCallCount: integer("active_call_count").notNull(),
  opportunityScore: integer("opportunity_score"),
  snapshotJson: text("snapshot_json").notNull(),
}, (table) => [
  uniqueIndex("idx_theme_signal_snapshots_run_scope_theme").on(table.ingestionRunId, table.scope, table.theme),
  index("idx_theme_signal_snapshots_scope_captured").on(table.scope, table.capturedAt),
  index("idx_theme_signal_snapshots_theme_year").on(table.theme, table.stableEndYear),
]);

export const userShortlistItems = sqliteTable("user_shortlist_items", {
  userId: text("user_id").notNull(),
  workId: text("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.workId] }),
  index("idx_user_shortlist_user_created").on(table.userId, table.createdAt),
  index("idx_user_shortlist_work").on(table.workId),
]);

export const sourceHealth = sqliteTable("source_health", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  ingestionRunId: text("ingestion_run_id").notNull().references(() => ingestionRuns.id, { onDelete: "restrict" }),
  checkName: text("check_name").notNull(),
  status: text("status").$type<"healthy" | "degraded" | "unavailable">().notNull(),
  latencyMs: integer("latency_ms"),
  httpStatus: integer("http_status"),
  errorMessage: text("error_message"),
  checkedAt: text("checked_at").notNull(),
}, (table) => [
  index("idx_source_health_source_checked").on(table.sourceId, table.checkedAt),
  index("idx_source_health_run").on(table.ingestionRunId),
]);

export const callIngestionRuns = sqliteTable("call_ingestion_runs", {
  id: text("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  status: text("status").$type<"running" | "succeeded" | "partial" | "failed">().notNull(),
  registryVersion: text("registry_version").notNull(),
  sourceVersion: text("source_version").notNull(),
  parserVersion: text("parser_version").notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  foundCount: integer("found_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  contentHash: text("content_hash"),
  requiresManualReview: integer("requires_manual_review", { mode: "boolean" }).notNull().default(false),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_call_ingestion_runs_source_started").on(table.sourceId, table.startedAt),
  index("idx_call_ingestion_runs_status_started").on(table.status, table.startedAt),
]);

export const calls = sqliteTable("calls", {
  id: text("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  sourceRecordId: text("source_record_id").notNull(),
  title: text("title").notNull(),
  callType: text("call_type").$type<"papers" | "special_issue" | "conference" | "workshop">().notNull(),
  organizer: text("organizer").notNull(),
  description: text("description").notNull(),
  officialUrl: text("official_url").notNull(),
  submissionDeadline: text("submission_deadline"),
  eventOrPublicationDate: text("event_or_publication_date"),
  status: text("status").$type<"open" | "closing" | "expired" | "unverified">().notNull(),
  parserVersion: text("parser_version").notNull(),
  sourceVersion: text("source_version").notNull(),
  firstCapturedAt: text("first_captured_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  verifiedAt: text("verified_at"),
}, (table) => [
  uniqueIndex("idx_calls_source_record_unique").on(table.sourceId, table.sourceRecordId),
  index("idx_calls_status_deadline").on(table.status, table.submissionDeadline),
  index("idx_calls_source_seen").on(table.sourceId, table.lastSeenAt),
]);

export const callVersions = sqliteTable("call_versions", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  ingestionRunId: text("ingestion_run_id").notNull().references(() => callIngestionRuns.id, { onDelete: "restrict" }),
  contentHash: text("content_hash").notNull(),
  title: text("title").notNull(),
  callType: text("call_type").$type<"papers" | "special_issue" | "conference" | "workshop">().notNull(),
  organizer: text("organizer").notNull(),
  description: text("description").notNull(),
  officialUrl: text("official_url").notNull(),
  submissionDeadline: text("submission_deadline"),
  eventOrPublicationDate: text("event_or_publication_date"),
  topicsJson: text("topics_json").notNull(),
  status: text("status").$type<"open" | "closing" | "expired" | "unverified">().notNull(),
  parserVersion: text("parser_version").notNull(),
  sourceVersion: text("source_version").notNull(),
  capturedAt: text("captured_at").notNull(),
  verifiedAt: text("verified_at"),
}, (table) => [
  uniqueIndex("idx_call_versions_content_unique").on(table.callId, table.contentHash),
  index("idx_call_versions_run").on(table.ingestionRunId),
  index("idx_call_versions_call_captured").on(table.callId, table.capturedAt),
]);

export const callThemes = sqliteTable("call_themes", {
  callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  theme: text("theme").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.callId, table.theme] }),
  index("idx_call_themes_theme").on(table.theme),
]);

export const callSourceState = sqliteTable("call_source_state", {
  sourceId: integer("source_id").primaryKey().references(() => sources.id, { onDelete: "restrict" }),
  registryVersion: text("registry_version").notNull(),
  sourceVersion: text("source_version").notNull(),
  parserVersion: text("parser_version").notNull(),
  status: text("status").$type<"verified" | "changed" | "parser_error" | "unavailable">().notNull(),
  approvedContentHash: text("approved_content_hash"),
  lastContentHash: text("last_content_hash"),
  lastCheckedAt: text("last_checked_at").notNull(),
  verifiedAt: text("verified_at"),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_call_source_state_status_checked").on(table.status, table.lastCheckedAt),
]);
