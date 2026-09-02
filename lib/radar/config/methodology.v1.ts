import type { RadarMethodologyManifest } from "@/app/radar-types";
import { CALL_SOURCE_REGISTRY_VERSION, OFFICIAL_CALL_SOURCES } from "@/lib/calls/config/sources.v1";
import { ANALYSIS_VERSION } from "../config";
import { DATA_QUALITY_CHECKS, DATA_QUALITY_THRESHOLDS, DATA_QUALITY_VERSION } from "./data-quality.v1";
import { computeRetrievalMetrics, GOLD_STANDARD_RECORDS, GOLD_STANDARD_VERSION } from "./gold-standard.v1";
import {
  AI_SEARCH_TERMS,
  ARXIV_CATEGORIES,
  ARXIV_PAGE_SIZE,
  DEFAULT_INGESTION_SAFETY_LIMIT,
  FIELD_SEARCH_TERMS,
  HUMAN_WORK_SEARCH_TERMS,
  OPENALEX_PAGE_SIZE,
  QUERY_VERSIONS,
  SEARCH_CONFIG_VERSION,
  SEARCH_LAYERS,
} from "./search.v3";
import {
  CORE_CONFERENCES,
  CORE_JOURNALS,
  FRONTIER_REPOSITORIES,
  SOURCE_CONFIG_VERSION,
} from "./sources.v3";
import {
  THEME_CLASSIFICATION_VERSION,
  THEME_ONTOLOGY_VERSION,
  THEME_SCORE_THRESHOLD,
  THEME_SCORE_WEIGHTS,
} from "./themes.v2";
import {
  CHANGE_POINT_Z_THRESHOLD,
  INDEXING_LAG_DAYS,
  LONG_TREND_WINDOW_YEARS,
  MINIMUM_TREND_PUBLICATIONS,
  SHORT_TREND_WINDOW_YEARS,
  TREND_ANALYSIS_VERSION,
  TREND_SNAPSHOT_VERSION,
} from "./trend-analysis.v1";

export const METHODOLOGY_VERSION = "methodology-1.0.0";
export const METHODOLOGY_SCHEMA_VERSION = "radar-methodology-schema-1.0.0";

const evaluation = computeRetrievalMetrics(GOLD_STANDARD_RECORDS);

export const METHODOLOGY_MANIFEST: RadarMethodologyManifest = {
  schemaVersion: METHODOLOGY_SCHEMA_VERSION,
  methodologyVersion: METHODOLOGY_VERSION,
  versions: {
    searchConfig: SEARCH_CONFIG_VERSION,
    queryByLayer: { ...QUERY_VERSIONS },
    sourceConfig: SOURCE_CONFIG_VERSION,
    analysis: ANALYSIS_VERSION,
    ontology: THEME_ONTOLOGY_VERSION,
    classification: THEME_CLASSIFICATION_VERSION,
    trendAnalysis: TREND_ANALYSIS_VERSION,
    trendSnapshot: TREND_SNAPSHOT_VERSION,
    callRegistry: CALL_SOURCE_REGISTRY_VERSION,
    dataQuality: DATA_QUALITY_VERSION,
    goldStandard: GOLD_STANDARD_VERSION,
  },
  sources: {
    discovery: ["OpenAlex", "arXiv"],
    enrichment: ["Crossref (nur DOI-basierte Metadatenanreicherung)"],
    coreJournalCount: CORE_JOURNALS.length,
    coreConferenceCount: CORE_CONFERENCES.length,
    frontierRepositoryCount: FRONTIER_REPOSITORIES.length,
    officialCallSourceCount: OFFICIAL_CALL_SOURCES.length,
  },
  search: {
    layers: [...SEARCH_LAYERS],
    aiTerms: AI_SEARCH_TERMS,
    humanWorkTerms: HUMAN_WORK_SEARCH_TERMS,
    fieldTerms: FIELD_SEARCH_TERMS,
    arxivCategories: ARXIV_CATEGORIES,
    openAlexPageSize: OPENALEX_PAGE_SIZE,
    arxivPageSize: ARXIV_PAGE_SIZE,
    ingestionSafetyLimit: DEFAULT_INGESTION_SAFETY_LIMIT,
  },
  inclusion: [
    "Core: Treffer in versioniert kuratierten Kernjournals oder Kernkonferenzen.",
    "Broad: feldweite OpenAlex-Suche ohne feste Venue-Liste.",
    "Frontier: Preprints, Proceedings und direkte arXiv-Treffer aus konfigurierten Kategorien.",
    "Treffer müssen die jeweils versionierten Human-/Work-Begriffe erfüllen; im KI-Scope zusätzlich die KI-Begriffe.",
  ],
  exclusion: [
    "Zurückgezogene OpenAlex-Datensätze werden durch is_retracted:false ausgeschlossen.",
    "Ungültige Datensätze ohne Titel oder stabile Quellen-ID werden nicht gespeichert.",
    "Crossref erzeugt keine zusätzlichen Discovery-Treffer.",
    "Calls aus nicht registrierten oder nicht offiziell autorisierten Quellen werden nicht eingelesen.",
  ],
  classification: {
    fields: ["Titel", "Abstract", "Keywords", "OpenAlex Topics"],
    weights: { ...THEME_SCORE_WEIGHTS },
    threshold: THEME_SCORE_THRESHOLD,
    method: "Deterministische normalisierte Wort- und Phrasengrenzen mit versionierter Ontologie, Varianten und expliziten Ausschlüssen.",
  },
  trends: {
    shortWindowYears: SHORT_TREND_WINDOW_YEARS,
    longWindowYears: LONG_TREND_WINDOW_YEARS,
    minimumPublications: MINIMUM_TREND_PUBLICATIONS,
    currentYearExcluded: true,
    indexingLagDays: INDEXING_LAG_DAYS,
    changePointThreshold: CHANGE_POINT_Z_THRESHOLD,
    method: "Gleich lange abgeschlossene Fenster; Change-Point als dokumentierte Poisson-z-Heuristik. Laufendes Jahr und Indexierungsreserve bleiben ausgeschlossen.",
  },
  calls: {
    interpretation: "Calls zeigen institutionelle Nachfrage und Agenda-Setzung, nicht wissenschaftliche Evidenz oder erwartete Publikationsmengen.",
    officialSourcesOnly: true,
    expiredHiddenByDefault: true,
  },
  quality: {
    checks: [...DATA_QUALITY_CHECKS],
    thresholds: { ...DATA_QUALITY_THRESHOLDS },
  },
  evaluation: {
    goldStandardVersion: GOLD_STANDARD_VERSION,
    ...evaluation,
  },
  knownLimitations: [
    "OpenAlex- und arXiv-Indexierung können verzögert oder unvollständig sein.",
    "OpenAlex Topics sind maschinell erzeugte Metadaten.",
    "Preprint- und Journalmanifestationen können denselben Forschungsbeitrag repräsentieren und bleiben bewusst verknüpft sichtbar.",
    "Precision und Recall werden ohne manuell verifizierten Goldstandard nicht berechnet.",
    "Plausibilitätswarnungen sind Prüfhinweise und keine automatische Korrektur von Quelldaten.",
  ],
};
