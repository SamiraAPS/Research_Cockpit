"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ShortlistResponse } from "@/app/radar-types";

const LOCAL_SHORTLIST_KEY = "human-ai-radar:shortlist:v1";

function readLocalShortlist() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SHORTLIST_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export type ShortlistControls = {
  ids: Set<string>;
  storage: "d1" | "browser" | "unavailable";
  ready: boolean;
  saving: boolean;
  error: string | null;
  toggle: (workId: string) => Promise<void>;
};

export function useShortlist(): ShortlistControls {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [storage, setStorage] = useState<ShortlistControls["storage"]>("unavailable");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/shortlist", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Die persönliche Shortlist ist vorübergehend nicht verfügbar.");
        return response.json() as Promise<ShortlistResponse>;
      })
      .then((payload) => {
        if (payload.authenticated) {
          setStorage("d1");
          setIds(new Set(payload.workIds));
        } else {
          setStorage("browser");
          setIds(readLocalShortlist());
        }
        setError(null);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setStorage("unavailable");
        setError(reason instanceof Error ? reason.message : "Die Shortlist konnte nicht geladen werden.");
      })
      .finally(() => setReady(true));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (storage !== "browser") return;
    const sync = (event: StorageEvent) => {
      if (event.key === LOCAL_SHORTLIST_KEY) setIds(readLocalShortlist());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storage]);

  const toggle = useCallback(async (workId: string) => {
    if (!ready || saving || storage === "unavailable") return;
    const selected = ids.has(workId);
    const next = new Set(ids);
    if (selected) next.delete(workId);
    else next.add(workId);
    setIds(next);
    setSaving(true);
    setError(null);
    try {
      if (storage === "browser") {
        window.localStorage.setItem(LOCAL_SHORTLIST_KEY, JSON.stringify([...next]));
      } else {
        const response = await fetch("/api/shortlist", {
          method: selected ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workId }),
        });
        if (!response.ok) throw new Error("Die Shortlist-Änderung konnte nicht gespeichert werden.");
      }
    } catch (reason) {
      setIds(ids);
      setError(reason instanceof Error ? reason.message : "Die Shortlist konnte nicht aktualisiert werden.");
    } finally {
      setSaving(false);
    }
  }, [ids, ready, saving, storage]);

  return useMemo(() => ({ ids, storage, ready, saving, error, toggle }), [error, ids, ready, saving, storage, toggle]);
}
