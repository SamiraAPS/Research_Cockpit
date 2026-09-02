import { NextRequest, NextResponse } from "next/server";

import { getD1 } from "@/db";
import { CACHE_DURATION_SECONDS, SEARCH_LAYERS, STALE_WHILE_REVALIDATE_SECONDS, type SearchLayer } from "@/lib/radar/config";
import { readRadarData } from "@/lib/radar/repository";

function storageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown database error";
  if (message.includes("no such table")) {
    return "Die D1-Datenbank ist noch nicht migriert. Wende die generierte Drizzle-Migration an, bevor das Dashboard Daten liest.";
  }
  if (message.includes("binding `DB` is unavailable")) return message;
  return "Der persistente Radar-Datenbestand konnte nicht gelesen werden.";
}

export async function GET(request: NextRequest) {
  const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "90");
  const days = [30, 90, 365].includes(daysRaw) ? daysRaw : 90;
  const scope = request.nextUrl.searchParams.get("scope") === "field" ? "field" : "ai";
  const layersValue = request.nextUrl.searchParams.get("layers");
  const layers = layersValue
    ? [...new Set(layersValue.split(",").map((value) => value.trim()).filter(Boolean))]
    : [...SEARCH_LAYERS];
  if (layers.length === 0 || layers.some((layer) => !SEARCH_LAYERS.includes(layer as SearchLayer))) {
    return NextResponse.json({ error: "layers darf nur core, broad und frontier enthalten." }, { status: 400 });
  }
  try {
    const payload = await readRadarData(await getD1(), { days, scope, layers: layers as SearchLayer[] });
    const response = NextResponse.json(payload);
    response.headers.set("Cache-Control", `public, s-maxage=${CACHE_DURATION_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`);
    return response;
  } catch (error) {
    return NextResponse.json({ error: storageError(error) }, { status: 503 });
  }
}
