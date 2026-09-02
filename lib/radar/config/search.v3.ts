export type SearchLayer = "core" | "broad" | "frontier";

export const SEARCH_CONFIG_VERSION = "search-3.0.0";
export const QUERY_VERSIONS: Record<SearchLayer | "trends", string> = {
  core: "openalex-core-3.0.0",
  broad: "openalex-broad-3.0.0",
  frontier: "openalex-arxiv-frontier-3.0.0",
  trends: "openalex-trends-6.0.0",
};

export const SEARCH_LAYERS: readonly SearchLayer[] = ["core", "broad", "frontier"];

export const AI_SEARCH_TERMS = [
  "artificial intelligence",
  "human-AI",
  "large language model",
  "large language models",
  "LLM",
  "foundation model",
  "foundation models",
  "ChatGPT",
  "generative AI",
  "AI agent",
  "AI agents",
  "algorithmic decision support",
  "algorithmic management",
  "intelligent automation",
  "machine learning system",
  "machine learning systems",
  "cobot",
  "cobots",
  "human-machine system",
  "human-machine systems",
] as const;

export const HUMAN_WORK_SEARCH_TERMS = [
  "learning",
  "deskilling",
  "skill degradation",
  "expertise",
  "cognitive engagement",
  "intrinsic motivation",
  "motivation",
  "work engagement",
  "agency",
  "worker autonomy",
  "work design",
  "job design",
  "situation awareness",
  "cognitive load",
  "cognitive workload",
  "human oversight",
  "trust",
  "trust in AI",
  "reliance",
  "automation bias",
  "safety",
  "psychological safety",
  "meaningful work",
  "human factors",
  "human-AI collaboration",
  "human-AI interaction",
] as const;

export const FIELD_SEARCH_TERMS = [
  ...HUMAN_WORK_SEARCH_TERMS,
  "ergonomics",
  "human performance",
  "occupational health",
  "sociotechnical systems",
  "human-machine interaction",
] as const;

export const ARXIV_CATEGORIES = ["cs.HC", "cs.AI", "cs.CY", "cs.RO", "cs.CL"] as const;

export const OPENALEX_PAGE_SIZE = 100;
export const ARXIV_PAGE_SIZE = 100;
export const DEFAULT_INGESTION_SAFETY_LIMIT = 5_000;
export const MAX_INGESTION_SAFETY_LIMIT = 25_000;
export const CROSSREF_ENRICHMENT_LIMIT = 100;
export const SOURCE_RETRY_ATTEMPTS = 3;
export const ARXIV_INTER_PAGE_DELAY_MS = 3_000;

function quoted(term: string) {
  return `"${term.replaceAll('"', '\\"')}"`;
}

export function booleanTerms(terms: readonly string[]) {
  return `(${terms.map(quoted).join(" OR ")})`;
}

export const AI_TERMS = booleanTerms(AI_SEARCH_TERMS);
export const HUMAN_AI_TERMS = booleanTerms(HUMAN_WORK_SEARCH_TERMS);
export const FIELD_TERMS = booleanTerms(FIELD_SEARCH_TERMS);
export const QUERY_VERSION = SEARCH_CONFIG_VERSION;
