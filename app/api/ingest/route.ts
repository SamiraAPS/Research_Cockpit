import { getD1, getRuntimeEnv } from "@/db";
import { OFFICIAL_CALL_SOURCES } from "@/lib/calls/config/sources.v1";
import { runCallsIngestion, type CallsIngestionRequest } from "@/lib/calls/ingestion";
import { runIngestion, type IngestionRequest } from "@/lib/radar/ingestion";
import { MAX_INGESTION_SAFETY_LIMIT, SEARCH_LAYERS } from "@/lib/radar/config";

function validSafetyLimit(value: unknown): value is number {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_INGESTION_SAFETY_LIMIT);
}

async function tokensMatch(actual: string, expected: string) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  if (actualBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) difference |= actualBytes[index] ^ expectedBytes[index];
  return difference === 0;
}

function parseRequest(value: unknown): IngestionRequest | CallsIngestionRequest | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { dataset?: unknown; layer?: unknown; scope?: unknown; safetyLimit?: unknown; sourceKeys?: unknown; approveChangedContent?: unknown };
  if (payload.dataset === "calls") {
    const allowedKeys = new Set(OFFICIAL_CALL_SOURCES.map((source) => source.key));
    const sourceKeys = payload.sourceKeys === undefined
      ? undefined
      : Array.isArray(payload.sourceKeys) && payload.sourceKeys.every((key) => typeof key === "string" && allowedKeys.has(key))
        ? [...new Set(payload.sourceKeys as string[])]
        : null;
    if (sourceKeys === null || (payload.approveChangedContent !== undefined && typeof payload.approveChangedContent !== "boolean")) return null;
    return { dataset: "calls", sourceKeys, approveChangedContent: payload.approveChangedContent as boolean | undefined };
  }
  if (typeof payload.layer === "string" && SEARCH_LAYERS.includes(payload.layer as (typeof SEARCH_LAYERS)[number]) &&
      (payload.scope === "ai" || payload.scope === "field") && validSafetyLimit(payload.safetyLimit)) {
    return { layer: payload.layer as (typeof SEARCH_LAYERS)[number], scope: payload.scope, safetyLimit: payload.safetyLimit };
  }
  if (payload.dataset === "trends" && (payload.scope === undefined || payload.scope === "all")) return { dataset: "trends", scope: "all" };
  if ((payload.dataset === "publications" || payload.dataset === "preprints") &&
      (payload.scope === "ai" || payload.scope === "field") && validSafetyLimit(payload.safetyLimit)) {
    return { dataset: payload.dataset, scope: payload.scope, safetyLimit: payload.safetyLimit };
  }
  return null;
}

export async function POST(request: Request) {
  const env = await getRuntimeEnv();
  const expectedToken = env.INGESTION_TOKEN ?? process.env.INGESTION_TOKEN;
  if (!expectedToken) {
    return Response.json({ error: "INGESTION_TOKEN ist in der Laufzeitumgebung nicht konfiguriert." }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!providedToken || !(await tokensMatch(providedToken, expectedToken))) {
    return Response.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ungültiger JSON-Request." }, { status: 400 });
  }
  const ingestionRequest = parseRequest(body);
  if (!ingestionRequest) {
    return Response.json({ error: "Die Ingestion-Parameter sind ungültig." }, { status: 400 });
  }

  try {
    const configuredSafetyLimitValue = env.RADAR_INGESTION_SAFETY_LIMIT ?? process.env.RADAR_INGESTION_SAFETY_LIMIT;
    const configuredSafetyLimit = configuredSafetyLimitValue
      ? Number(configuredSafetyLimitValue)
      : undefined;
    if (!validSafetyLimit(configuredSafetyLimit)) {
      return Response.json({ error: `RADAR_INGESTION_SAFETY_LIMIT muss zwischen 1 und ${MAX_INGESTION_SAFETY_LIMIT} liegen.` }, { status: 503 });
    }
    const database = await getD1();
    const result = "dataset" in ingestionRequest && ingestionRequest.dataset === "calls"
      ? await runCallsIngestion(database, ingestionRequest)
      : await runIngestion(database, ingestionRequest, {
          safetyLimit: configuredSafetyLimit,
          openAlexApiKey: env.OPENALEX_API_KEY ?? process.env.OPENALEX_API_KEY,
          crossrefMailto: env.CROSSREF_MAILTO ?? process.env.CROSSREF_MAILTO,
        });
    const status = result.status === "succeeded" ? 201 : result.status === "partial" ? 207 : 502;
    return Response.json({ ingestion: result }, { status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ingestion konnte nicht gestartet werden." }, { status: 500 });
  }
}
