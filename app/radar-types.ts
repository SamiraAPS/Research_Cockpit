export type DataStatus = "live" | "partial" | "unavailable";
export type SearchLayer = "core" | "broad" | "frontier";

export type RadarWork = {
  id: string;
  title: string;
  publicationDate: string;
  source: string;
  sourceType: "journal" | "preprint" | "proceedings";
  searchLayers: SearchLayer[];
  authors: string[];
  citedBy: number;
  url: string;
  isOpenAccess: boolean;
  themes: string[];
  themeClassifications: RadarThemeClassification[];
  why: string;
  relevanceScore: number;
};

export type CorpusSort = "date" | "relevance" | "citations" | "emerging";
export type CorpusMode = "all" | "new" | "weekly" | "shortlist";

export type RadarCorpusWork = RadarWork & {
  abstract: string | null;
  doi: string | null;
  onlineDate: string | null;
  openAccessStatus: string | null;
  topics: string[];
  keywords: string[];
  retrievedAt: string;
  firstSeenAt: string;
  sourceKind: "journal" | "conference" | "repository";
  dataStatus: DataStatus;
  ingestionStatus: "succeeded" | "partial" | "failed" | "running";
  emergingSignal: {
    rank: number;
    status: "burst" | "rising" | "stable" | "cooling" | "insufficient";
  };
};

export type RadarCorpusFacet = {
  value: string;
  label: string;
  count: number;
};

export type RadarCorpusResponse = {
  status: DatasetAvailability;
  queriedAt: string;
  mode: CorpusMode;
  scope: "ai" | "field";
  items: RadarCorpusWork[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  facets: {
    venues: Array<RadarCorpusFacet & { kind: RadarCorpusWork["sourceKind"] }>;
    themes: RadarCorpusFacet[];
    workDomains: RadarCorpusFacet[];
    studyTypes: RadarCorpusFacet[];
    studyTypeDataAvailable: boolean;
  };
  latestSuccessfulRun: {
    id: string;
    source: string;
    searchLayer: SearchLayer;
    startedAt: string;
    endedAt: string;
    newCount: number;
  } | null;
  weeklyWindow: {
    anchorAt: string;
    startAt: string;
    endAt: string;
  } | null;
};

export type ShortlistResponse = {
  authenticated: boolean;
  storage: "d1" | "browser";
  workIds: string[];
  updatedAt: string | null;
};

export type RadarThemeEvidence = {
  source: "title" | "abstract" | "keyword" | "openalex_topic";
  concept: string;
  conceptLabel: string;
  matchedTerm: string;
  sourceValue: string;
  weight: number;
};

export type RadarThemeClassification = {
  theme: string;
  label: string;
  score: number;
  classificationVersion: string;
  ontologyVersion: string;
  evidence: RadarThemeEvidence[];
};

export type RadarLensQuestion = {
  id: string;
  kind: "lens";
  theme: string;
  label: string;
  question: string;
  rationale: string;
};

export type RadarQuestionEvidence = {
  workId: string;
  title: string;
  url: string;
};

export type RadarDerivedQuestion = {
  id: string;
  kind: "data-derived";
  pattern: "theme_cooccurrence";
  status: "supported" | "insufficient";
  themes: string[];
  label: string;
  question: string;
  explanation: string;
  count: number;
  minimumEvidenceRecords: number;
  evidence: RadarQuestionEvidence[];
};

export type RadarQuestions = {
  analysisVersion: string;
  minimumEvidenceRecords: number;
  lens: RadarLensQuestion[];
  dataDerived: RadarDerivedQuestion[];
};

export type RadarThemeDistribution = {
  theme: string;
  label: string;
  count: number;
  share: number;
  configuredVocabularySize: number;
};

export type RadarThemeAnalysis = {
  ontologyVersion: string;
  classificationVersion: string;
  scoreThreshold: number;
  weights: Record<RadarThemeEvidence["source"], number>;
  distribution: RadarThemeDistribution[];
  comparisonCaveat: string;
};

export type RadarTrendPoint = {
  year: number;
  article: number | null;
  preprint: number | null;
};

export type TrendDataQualityStatus = "sufficient" | "limited" | "insufficient" | "unavailable";

export type RadarTrendWindow = {
  startYear: number;
  endYear: number;
  yearCount: number;
  absoluteCount: number;
  normalizedCount: number;
  comparisonFieldCount: number | null;
  perThousand: number | null;
  journalCount: number;
  preprintCount: number;
  proceedingsCount: number;
  journalShare: number | null;
  preprintShare: number | null;
};

export type RadarAnnualThemeMetric = {
  year: number;
  absoluteCount: number;
  journalCount: number;
  preprintCount: number;
  proceedingsCount: number;
  comparisonFieldCount: number | null;
  perThousand: number | null;
  partial: boolean;
  excludedFromComparisons: boolean;
};

export type RadarOpportunityComponent = {
  key: "agenda" | "emerging" | "low_peer_reviewed_saturation" | "strategic_fit";
  label: string;
  score: number;
  maximum: 25;
  rationale: string;
};

export type RadarThemeTrendSignal = {
  theme: string;
  label: string;
  snapshotVersion: string;
  analysisVersion: string;
  capturedAt: string;
  stableEndYear: number;
  currentYear: { year: number; count: number; partial: true; includedInComparisons: false };
  windows: {
    shortRecent: RadarTrendWindow;
    shortPrevious: RadarTrendWindow;
    shortBaseline: RadarTrendWindow;
    longRecent: RadarTrendWindow;
    longPrevious: RadarTrendWindow;
  };
  shortGrowthPercent: number | null;
  longGrowthPercent: number | null;
  accelerationPercentagePoints: number | null;
  acceleration: "accelerating" | "slowing" | "steady" | "insufficient";
  changePoint: {
    detected: boolean;
    direction: "up" | "down" | "none" | "insufficient";
    zScore: number | null;
    threshold: number;
    method: string;
  };
  diversity: {
    sourceCount: number;
    venueCount: number;
    venueDiversityPercent: number | null;
    largestVenueShare: number | null;
  };
  observedTrend: {
    status: "growing" | "declining" | "stable" | "mixed" | "insufficient";
    interpretation: string;
  };
  emergingSignal: {
    status: "burst" | "rising" | "stable" | "cooling" | "insufficient";
    interpretation: string;
  };
  agendaSignal: {
    status: "strong" | "moderate" | "weak" | "unavailable";
    activeCalls: number;
    closingCalls: number;
    interpretation: string;
  };
  opportunity: {
    status: "possible" | "mixed" | "low" | "insufficient";
    score: number | null;
    maximum: 100;
    components: RadarOpportunityComponent[];
    interpretation: string;
  };
  dataQuality: {
    status: TrendDataQualityStatus;
    minimumPublications: number;
    recentWindowCount: number;
    issues: string[];
  };
  contradictions: string[];
  annual: RadarAnnualThemeMetric[];
};

export type RadarTrendAnalysis = {
  status: DatasetAvailability;
  snapshotAt: string | null;
  snapshotVersion: string;
  analysisVersion: string;
  scope: "ai" | "field";
  comparisonField: string;
  currentYear: number;
  currentYearExcluded: true;
  latestStableYear: number;
  indexingLagDays: number;
  excludedForIndexingLag: number[];
  minimumPublications: number;
  themes: RadarThemeTrendSignal[];
  method: {
    shortWindowYears: number;
    longWindowYears: number;
    changePoint: string;
    opportunity: string;
  };
};

export type DatasetAvailability = {
  status: DataStatus;
  error: string | null;
};

export type RadarDataQualityWarning = {
  id: string;
  check: "unexpected_zero_hits" | "source_decline" | "high_duplicate_share" | "missing_abstracts" | "stale_ingestion_run" | "source_partial" | "source_unavailable";
  severity: "warning" | "error";
  source: string;
  searchLayer: SearchLayer | "trends";
  ingestionRunId: string;
  metric: number | null;
  threshold: number | null;
  message: string;
};

export type RadarDataQualityReport = {
  version: string;
  generatedAt: string;
  status: DataStatus;
  thresholds: {
    sourceDeclinePercent: number;
    duplicateSharePercent: number;
    missingAbstractSharePercent: number;
    staleRunHours: number;
  };
  checkedRunCount: number;
  warnings: RadarDataQualityWarning[];
};

export type RadarEvaluationStatus = {
  goldStandardVersion: string;
  status: "not_available" | "partial" | "available";
  manuallyLabeledCount: number;
  precision: number | null;
  recall: number | null;
  reason: string | null;
};

export type RadarMethodologyManifest = {
  schemaVersion: string;
  methodologyVersion: string;
  versions: {
    searchConfig: string;
    queryByLayer: Record<SearchLayer | "trends", string>;
    sourceConfig: string;
    analysis: string;
    ontology: string;
    classification: string;
    trendAnalysis: string;
    trendSnapshot: string;
    callRegistry: string;
    dataQuality: string;
    goldStandard: string;
  };
  sources: {
    discovery: string[];
    enrichment: string[];
    coreJournalCount: number;
    coreConferenceCount: number;
    frontierRepositoryCount: number;
    officialCallSourceCount: number;
  };
  search: {
    layers: SearchLayer[];
    aiTerms: readonly string[];
    humanWorkTerms: readonly string[];
    fieldTerms: readonly string[];
    arxivCategories: readonly string[];
    openAlexPageSize: number;
    arxivPageSize: number;
    ingestionSafetyLimit: number;
  };
  inclusion: string[];
  exclusion: string[];
  classification: {
    fields: string[];
    weights: Record<RadarThemeEvidence["source"], number>;
    threshold: number;
    method: string;
  };
  trends: {
    shortWindowYears: number;
    longWindowYears: number;
    minimumPublications: number;
    currentYearExcluded: true;
    indexingLagDays: number;
    changePointThreshold: number;
    method: string;
  };
  calls: {
    interpretation: string;
    officialSourcesOnly: true;
    expiredHiddenByDefault: true;
  };
  quality: {
    checks: string[];
    thresholds: RadarDataQualityReport["thresholds"];
  };
  evaluation: RadarEvaluationStatus;
  knownLimitations: string[];
};

export type CallType = "papers" | "special_issue" | "conference" | "workshop";
export type CallStatus = "open" | "closing" | "expired" | "unverified";

export type RadarCall = {
  id: string;
  title: string;
  callType: CallType;
  organizer: string;
  description: string;
  officialUrl: string;
  submissionDeadline: string | null;
  eventOrPublicationDate: string | null;
  themes: string[];
  capturedAt: string;
  lastCheckedAt: string;
  verifiedAt: string | null;
  status: CallStatus;
  parserVersion: string;
  sourceVersion: string;
  sourceKey: string;
  sourceName: string;
};

export type CallAgendaSignal = {
  theme: string;
  count: number;
  closingCount: number;
  nearestDeadline: string | null;
};

export type RadarCallSourceStatus = {
  key: string;
  name: string;
  officialUrl: string;
  status: "verified" | "changed" | "parser_error" | "unavailable";
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  error: string | null;
  parserVersion: string;
  sourceVersion: string;
};

export type CallsData = {
  status: DatasetAvailability;
  registryVersion: string;
  verifiedAt: string | null;
  calls: RadarCall[];
  agendaSignals: CallAgendaSignal[];
  counts: {
    totalStored: number;
    active: number;
    open: number;
    closing: number;
    expired: number;
    unverified: number;
  };
  sources: RadarCallSourceStatus[];
  interpretation: string;
};

export type RadarData = {
  dashboardQueriedAt: string;
  newestPublicationDate: string | null;
  analysisVersion: string;
  queryVersion: string;
  cacheDurationSeconds: number;
  staleWhileRevalidateSeconds: number;
  storage: {
    state: "empty" | "ready";
    lastIngestionAt: string | null;
    dataSnapshotAt: string | null;
  };
  status: DataStatus;
  dataStatus: {
    publications: DatasetAvailability;
    preprints: DatasetAvailability;
    trends: DatasetAvailability;
    calls: DatasetAvailability;
  };
  layerStatus: Record<SearchLayer, DatasetAvailability>;
  searchLayers: SearchLayer[];
  availableSearchLayers: SearchLayer[];
  scope: "ai" | "field";
  days: number;
  counts: {
    journal: number | null;
    preprint: number | null;
    totalFound: number;
    totalFoundComplete: boolean;
    analyzed: number;
    displayed: number;
  };
  works: RadarWork[];
  questions: RadarQuestions;
  themeAnalysis: RadarThemeAnalysis;
  trend: RadarTrendPoint[];
  trendAnalysis: RadarTrendAnalysis;
  calls: CallsData;
  quality: RadarDataQualityReport;
  methodology: RadarMethodologyManifest;
  sources: {
    journals: ReadonlyArray<{ id: string; name: string; area: string }>;
    conferences: ReadonlyArray<{ id: string; name: string; area: string }>;
    preprints: ReadonlyArray<{ id: string; name: string }>;
  };
  method: {
    psychologyField: string;
    aiTerms: string;
    humanTerms: string;
    fieldTerms: string;
    deduplication: string;
  };
};
