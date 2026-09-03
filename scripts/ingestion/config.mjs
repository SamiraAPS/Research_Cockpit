export const STATIC_SEARCH_CONFIG_VERSION = "static-search-4.0.0";
export const INGESTION_ANALYSIS_VERSION = "ingestion-relevance-1.0.0";
export const ONTOLOGY_VERSION = "human-work-themes-2.0.0";
export const WORKS_SCHEMA_VERSION = "works-page-1.1.0";
export const SEARCH_INDEX_SCHEMA_VERSION = "search-index-1.0.0";
export const META_SCHEMA_VERSION = "radar-meta-1.0.0";
export const SOURCE_HEALTH_SCHEMA_VERSION = "source-health-1.1.0";

export const OPENALEX_PAGE_SIZE = 100;
export const ARXIV_PAGE_SIZE = 100;
export const OUTPUT_PAGE_SIZE = 100;
export const DEFAULT_DAYS = 90;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRY_ATTEMPTS = 4;
export const ARXIV_INTER_PAGE_DELAY_MS = 3_000;
export const CROSSREF_INTER_REQUEST_DELAY_MS = 100;

export const AI_TERMS = [
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
  "human-machine systems"
];

export const HUMAN_WORK_TERMS = [
  "learning",
  "deskilling",
  "skill degradation",
  "expertise",
  "cognitive engagement",
  "intrinsic motivation",
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
  "ergonomics",
  "human-AI collaboration",
  "human-AI interaction",
  "human performance",
  "occupational health",
  "sociotechnical systems",
  "human-machine interaction"
];

export const ARXIV_CATEGORIES = ["cs.HC", "cs.AI", "cs.CY", "cs.RO", "cs.CL"];

export const CORE_JOURNALS = [
  { id: "S94432539", name: "Applied Ergonomics", area: "Human Factors & Ergonomics" },
  { id: "S72159247", name: "Ergonomics", area: "Human Factors & Ergonomics" },
  { id: "S83386566", name: "Human Factors", area: "Human Factors & Ergonomics" },
  { id: "S92539022", name: "International Journal of Industrial Ergonomics", area: "Human Factors & Ergonomics" },
  { id: "S113222589", name: "Cognition, Technology & Work", area: "Work Design" },
  { id: "S153474389", name: "Journal of Cognitive Engineering and Decision Making", area: "Cognitive Systems" },
  { id: "S4210190811", name: "International Journal of Human-Computer Studies", area: "Human–AI Interaction" },
  { id: "S165559636", name: "International Journal of Human-Computer Interaction", area: "Human–AI Interaction" },
  { id: "S2476799526", name: "IEEE Transactions on Human-Machine Systems", area: "Human–AI Interaction" },
  { id: "S204030396", name: "Computers in Human Behavior", area: "Psychology" },
  { id: "S175747132", name: "New Technology, Work and Employment", area: "Work Design" },
  { id: "S141527467", name: "Work & Stress", area: "Work Psychology" },
  { id: "S3481703", name: "Journal of Occupational Health Psychology", area: "Work Psychology" },
  { id: "S166002381", name: "Journal of Applied Psychology", area: "Psychology" },
  { id: "S64744539", name: "Organizational Behavior and Human Decision Processes", area: "Psychology" },
  { id: "S4210190517", name: "AI & Society", area: "Human–AI Interaction" },
  { id: "S123149298", name: "Safety Science", area: "Human Factors & Safety" },
  { id: "S206124708", name: "Organization Science", area: "Work Design" },
  { id: "S28882882", name: "Organization Studies", area: "Work Design" },
  { id: "S61446109", name: "Human Relations", area: "Work Psychology" },
  { id: "S57293258", name: "MIS Quarterly", area: "Human–AI Interaction" },
  { id: "S202812398", name: "Information Systems Research", area: "Human–AI Interaction" },
  { id: "S9954729", name: "Journal of Management Information Systems", area: "Human–AI Interaction" }
];

export const CORE_CONFERENCES = [
  { id: "S4363607743", name: "CHI Conference on Human Factors in Computing Systems", area: "CHI" },
  { id: "S4210183893", name: "Proceedings of the ACM on Human-Computer Interaction", area: "CSCW/PACMHCI" },
  { id: "S4306418948", name: "Intelligent User Interfaces", area: "IUI" },
  { id: "S4306418552", name: "Human-Robot Interaction", area: "HRI" },
  { id: "S4363608268", name: "Designing Interactive Systems Conference", area: "DIS" },
  { id: "S4210176815", name: "Human Factors and Ergonomics Society Annual Meeting", area: "HFES" }
];

export const FRONTIER_REPOSITORIES = [
  { id: "S4306400194", name: "arXiv" },
  { id: "S4306401687", name: "PsyArXiv" },
  { id: "S3005725775", name: "PsyArXiv" },
  { id: "S4306401238", name: "SocArXiv" },
  { id: "S3006283864", name: "SocArXiv" },
  { id: "S4306401127", name: "OSF Preprints" },
  { id: "S4210172589", name: "SSRN" },
  { id: "S4306525896", name: "Research Square" },
  { id: "S4306525895", name: "Research Square" },
  { id: "S6309402219", name: "Preprints.org" }
];

export const SEARCH_MODES = {
  core: {
    queryVersion: "static-openalex-core-4.0.0",
    providers: ["openalex"],
    sourceIds: [...CORE_JOURNALS, ...CORE_CONFERENCES].map((source) => source.id),
    workTypes: ["article", "review", "book-chapter", "proceedings-article"]
  },
  broad: {
    queryVersion: "static-openalex-broad-4.0.0",
    providers: ["openalex"],
    sourceIds: [],
    workTypes: ["article", "review", "book-chapter", "proceedings-article"]
  },
  frontier: {
    queryVersion: "static-openalex-arxiv-frontier-4.0.0",
    providers: ["openalex", "arxiv"],
    sourceIds: [...FRONTIER_REPOSITORIES, ...CORE_CONFERENCES, { id: "S4363607762" }].map((source) => source.id),
    workTypes: ["preprint", "article", "proceedings-article"]
  }
};

export const SEARCH_MODE_NAMES = Object.freeze(Object.keys(SEARCH_MODES));

export function selectedModes(value) {
  if (value === "all") return [...SEARCH_MODE_NAMES];
  if (!SEARCH_MODE_NAMES.includes(value)) throw new Error(`Unbekannter Modus ${JSON.stringify(value)}; erlaubt: core, broad, frontier, all`);
  return [value];
}
