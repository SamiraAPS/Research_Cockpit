import { getChatGPTUser } from "@/app/chatgpt-auth";
import type { ShortlistResponse } from "@/app/radar-types";
import { getD1 } from "@/db";
import { addUserShortlistItem, readUserShortlist, removeUserShortlistItem } from "@/lib/radar/corpus-repository";

function workIdFrom(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const workId = (value as { workId?: unknown }).workId;
  return typeof workId === "string" && workId.length > 0 && workId.length <= 100 ? workId : null;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ authenticated: false, storage: "browser", workIds: [], updatedAt: null } satisfies ShortlistResponse);
  try {
    const rows = await readUserShortlist(await getD1(), user.id);
    return Response.json({
      authenticated: true,
      storage: "d1",
      workIds: rows.map((row) => row.work_id),
      updatedAt: rows.map((row) => row.updated_at).sort().at(-1) ?? null,
    } satisfies ShortlistResponse, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Die persönliche Shortlist konnte nicht gelesen werden." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Keine sichere Nutzeridentität verfügbar.", fallback: "browser" }, { status: 401 });
  const workId = workIdFrom(await request.json().catch(() => null));
  if (!workId) return Response.json({ error: "Ungültige Publikations-ID." }, { status: 400 });
  try {
    const stored = await addUserShortlistItem(await getD1(), user.id, workId);
    return stored ? Response.json({ stored: true }, { status: 201 }) : Response.json({ error: "Publikation nicht gefunden." }, { status: 404 });
  } catch {
    return Response.json({ error: "Die Shortlist konnte nicht gespeichert werden." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Keine sichere Nutzeridentität verfügbar.", fallback: "browser" }, { status: 401 });
  const workId = workIdFrom(await request.json().catch(() => null));
  if (!workId) return Response.json({ error: "Ungültige Publikations-ID." }, { status: 400 });
  try {
    await removeUserShortlistItem(await getD1(), user.id, workId);
    return Response.json({ stored: false });
  } catch {
    return Response.json({ error: "Die Shortlist konnte nicht aktualisiert werden." }, { status: 503 });
  }
}
