import { NextRequest } from "next/server";

import type { RadarCorpusWork, SearchLayer } from "@/app/radar-types";
import { getD1 } from "@/db";
import { GOLD_STANDARD_VERSION } from "@/lib/radar/config/gold-standard.v1";
import { METHODOLOGY_VERSION } from "@/lib/radar/config/methodology.v1";
import { SEARCH_CONFIG_VERSION } from "@/lib/radar/config/search.v3";
import { searchCorpus } from "@/lib/radar/corpus-repository";
import { worksToAuditCsv } from "@/lib/radar/export";

function value(request: NextRequest, name: string) {
  const current = request.nextUrl.searchParams.get(name)?.trim();
  return current || null;
}

export async function GET(request: NextRequest) {
  try {
    const result = await searchCorpus(await getD1(), {
      scope: value(request, "scope") === "field" ? "field" : "ai",
      page: 1,
      pageSize: 5_000,
      query: value(request, "q") ?? undefined,
      layer: value(request, "layer") as SearchLayer | null,
      venueKind: value(request, "venueKind") as RadarCorpusWork["sourceKind"] | null,
      venue: value(request, "venue"),
      theme: value(request, "theme"),
      publicationType: value(request, "publicationType") as RadarCorpusWork["sourceType"] | null,
      fromYear: Number(value(request, "fromYear")) || null,
      toYear: Number(value(request, "toYear")) || null,
      workDomain: value(request, "workDomain"),
      sort: "date",
      mode: "all",
      includeFacets: false,
    });
    const body = worksToAuditCsv(result.items, {
      methodologyVersion: METHODOLOGY_VERSION,
      goldStandardVersion: GOLD_STANDARD_VERSION,
      queryVersion: SEARCH_CONFIG_VERSION,
    });
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="human-ai-radar-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "private, no-store",
        "x-radar-audit-count": String(result.items.length),
        "x-radar-audit-truncated": result.pagination.total > result.items.length ? "true" : "false",
      },
    });
  } catch {
    return Response.json({ error: "Der Audit-Export konnte nicht aus dem gespeicherten Korpus erstellt werden." }, { status: 503 });
  }
}
