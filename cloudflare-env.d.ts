declare module "cloudflare:workers" {
  export const env: {
    DB?: import("./db/d1").D1DatabaseLike;
    INGESTION_TOKEN?: string;
    OPENALEX_API_KEY?: string;
    CROSSREF_MAILTO?: string;
    RADAR_INGESTION_SAFETY_LIMIT?: string;
  };
}
