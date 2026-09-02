import { NextRequest, NextResponse } from "next/server";

import type { CorpusMode, CorpusSort, RadarCorpusWork, SearchLayer } from "@/app/radar-types";
import { getD1 } from "@/db";
import { SEARCH_LAYERS } from "@/lib/radar/config";
import { searchCorpus } from "@/lib/radar/corpus-repository";

const SORTS: CorpusSort[] = ["date", "relevance", "citations", "emerging"];
const MODES: CorpusMode[] = ["all", "new", "weekly", "shortlist"];
const VERSION_TYPES = ["journal", "preprint", "proceedings"] as const;
const VENUE_KINDS: RadarCorpusWork["sourceKind"][] = ["journal", "conference", "repository"];

function optionalText(request: NextRequest, name: string, maximum = 200) {
  const value = request.nextUrl.searchParams.get(name)?.trim();
  return value && value.length <= maximum ? value : null;
}

function year(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= new Date().getUTCFullYear() + 1 ? parsed : null;
}

function storageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown database error";
  if (message.includes("no such table")) return "Die D1-Datenbank ist noch nicht vollständig migriert.";
  return "Der gespeicherte Forschungskorpus konnte nicht durchsucht werden.";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") === "field" ? "field" : "ai";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSizeRaw = Number.parseInt(params.get("pageSize") ?? "20", 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 10), 50);
  const sortValue = params.get("sort") as CorpusSort | null;
  const modeValue = params.get("mode") as CorpusMode | null;
  const layerValue = params.get("layer") as SearchLayer | null;
  const venueKindValue = params.get("venueKind") as RadarCorpusWork["sourceKind"] | null;
  const publicationTypeValue = params.get("publicationType") as (typeof VERSION_TYPES)[number] | null;
  const fromYear = year(params.get("fromYear"));
  const toYear = year(params.get("toYear"));
  if (params.has("fromYear") && fromYear === null || params.has("toYear") && toYear === null || fromYear && toYear && fromYear > toYear) {
    return NextResponse.json({ error: "Der Zeitraum ist ungültig." }, { status: 400 });
  }
  if (layerValue && !SEARCH_LAYERS.includes(layerValue)) return NextResponse.json({ error: "Ungültige Suchschicht." }, { status: 400 });
  if (sortValue && !SORTS.includes(sortValue)) return NextResponse.json({ error: "Ungültige Sortierung." }, { status: 400 });
  if (modeValue && !MODES.includes(modeValue)) return NextResponse.json({ error: "Ungültige Korpusansicht." }, { status: 400 });
  if (venueKindValue && !VENUE_KINDS.includes(venueKindValue)) return NextResponse.json({ error: "Ungültiger Quellentyp." }, { status: 400 });
  if (publicationTypeValue && !VERSION_TYPES.includes(publicationTypeValue)) return NextResponse.json({ error: "Ungültiger Publikationstyp." }, { status: 400 });
  const ids = params.get("ids")?.split(",").map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 100).slice(0, 250) ?? [];
  try {
    const payload = await searchCorpus(await getD1(), {
      scope,
      page,
      pageSize,
      query: optionalText(request, "q") ?? undefined,
      layer: layerValue,
      venueKind: venueKindValue,
      venue: optionalText(request, "venue"),
      theme: optionalText(request, "theme", 80),
      publicationType: publicationTypeValue,
      fromYear,
      toYear,
      workDomain: optionalText(request, "workDomain"),
      sort: sortValue ?? "date",
      mode: modeValue ?? "all",
      ids,
    });
    const response = NextResponse.json(payload);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return NextResponse.json({ error: storageError(error) }, { status: 503 });
  }
}
