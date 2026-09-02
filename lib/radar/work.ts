import type { SearchLayer } from "./config";

export type WorkVersionType = "journal" | "preprint" | "proceedings";
export type WorkProvider = "openalex" | "arxiv";

export type IngestibleWork = {
  provider: WorkProvider;
  doi: string | null;
  doiNormalized: string | null;
  openAlexId: string | null;
  sourceRecordId: string;
  normalizedTitle: string;
  title: string;
  abstract: string | null;
  authors: Array<{ id: string | null; name: string; orcid: string | null; position: string | null }>;
  sourceExternalId: string | null;
  sourceName: string;
  sourceKind: "journal" | "conference" | "repository";
  sourceType: WorkVersionType;
  publicationDate: string | null;
  onlineDate: string | null;
  url: string;
  isOpenAccess: boolean;
  openAccessStatus: string | null;
  citedByCount: number;
  topics: string[];
  keywords: string[];
  themes: string[];
  retrievedAt: string;
};

export type WorkDiscoveryContext = {
  ingestionRunId: string;
  scope: "ai" | "field";
  searchLayer: SearchLayer;
  queryVersion: string;
};

