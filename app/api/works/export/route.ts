import { NextRequest } from "next/server";

import type { CorpusMode, CorpusSort, RadarCorpusWork, SearchLayer } from "@/app/radar-types";
import { getD1 } from "@/db";
import { searchCorpus } from "@/lib/radar/corpus-repository";
import { worksToBibtex, worksToCsv } from "@/lib/radar/export";

function value(request: NextRequest, name: string) {
  const current = request.nextUrl.searchParams.get(name)?.trim();
  return current || null;
}

export async function GET(request: NextRequest) {
  const format = value(request, "format") === "bibtex" ? "bibtex" : "csv";
  const ids = value(request, "ids")?.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 250) ?? [];
  const requestedMode = value(request, "mode") as CorpusMode | null;
  const mode: CorpusMode = ids.length ? "shortlist" : requestedMode === "new" || requestedMode === "weekly" ? requestedMode : "all";
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
      sort: (value(request, "sort") as CorpusSort | null) ?? "date",
      mode,
      ids,
      includeFacets: false,
    });
    const body = format === "bibtex" ? worksToBibtex(result.items) : worksToCsv(result.items);
    const extension = format === "bibtex" ? "bib" : "csv";
    return new Response(body, {
      headers: {
        "content-type": format === "bibtex" ? "application/x-bibtex; charset=utf-8" : "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="human-ai-radar-${new Date().toISOString().slice(0, 10)}.${extension}"`,
        "cache-control": "private, no-store",
        "x-radar-export-count": String(result.items.length),
        "x-radar-export-truncated": result.pagination.total > result.items.length ? "true" : "false",
      },
    });
  } catch {
    return Response.json({ error: "Der Export konnte nicht aus dem gespeicherten Korpus erstellt werden." }, { status: 503 });
  }
}
