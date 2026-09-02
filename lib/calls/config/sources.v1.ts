import type { OfficialCallSource } from "../types";

export const CALL_SOURCE_REGISTRY_VERSION = "calls-sources-1.0.0";

export const OFFICIAL_CALL_SOURCES: readonly OfficialCallSource[] = [
  {
    key: "acm-chi-2027",
    name: "ACM CHI 2027 Calls",
    organization: "ACM SIGCHI",
    kind: "organization",
    url: "https://chi2027.acm.org/",
    adapter: "acm-chi",
    sourceVersion: "acm-chi-2027.1",
    parserVersion: "acm-chi-parser-1.0.0",
    allowedHosts: ["chi2027.acm.org"],
  },
  {
    key: "ahfe-2027",
    name: "AHFE 2027 Submissions",
    organization: "AHFE International",
    kind: "organization",
    url: "https://www.ahfe.org/submissions.html",
    adapter: "ahfe",
    sourceVersion: "ahfe-2027.1",
    parserVersion: "ahfe-parser-1.0.0",
    allowedHosts: ["ahfe.org", "www.ahfe.org"],
  },
  {
    key: "elsevier-safety-science",
    name: "Safety Science Calls for Papers",
    organization: "Elsevier / ScienceDirect",
    kind: "publisher",
    url: "https://www.sciencedirect.com/journal/safety-science/about/call-for-papers",
    adapter: "elsevier-journal",
    sourceVersion: "elsevier-safety-science.1",
    parserVersion: "elsevier-journal-parser-1.0.0",
    allowedHosts: ["sciencedirect.com", "www.sciencedirect.com"],
  },
  {
    key: "sage-human-relations",
    name: "Human Relations Calls for Papers",
    organization: "SAGE / Human Relations",
    kind: "publisher",
    url: "https://journals.sagepub.com/page/hum/call-for-papers",
    adapter: "sage-journal",
    sourceVersion: "sage-human-relations.1",
    parserVersion: "sage-journal-parser-1.0.0",
    allowedHosts: ["journals.sagepub.com"],
  },
] as const;

export function findCallSource(key: string) {
  return OFFICIAL_CALL_SOURCES.find((source) => source.key === key) ?? null;
}
