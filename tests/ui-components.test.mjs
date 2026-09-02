import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the radar's responsive data-integrity styles", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /\.data-integrity-bar\{/);
  assert.match(css, /\.dataset-status\.unavailable/);
  assert.match(css, /\.relevance-wrap/);
  assert.match(css, /@media \(width<=760px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.workflow-overview-grid\{/);
  assert.match(css, /\.corpus-filter-grid\{/);
  assert.match(css, /\.publication-data-state\.unavailable/);
  assert.match(css, /\.quality-warning-list\{/);
  assert.match(css, /\.audit-actions\{/);
  assert.match(css, /@media \(width<=460px\)/);
});

test("renders accessible corpus workflow controls and honest unavailable filters", async () => {
  const { CorpusBrowser } = await vite.ssrLoadModule("/app/corpus-browser.tsx");
  const shortlist = {
    ids: new Set(),
    ready: true,
    saving: false,
    storage: "browser",
    error: null,
    toggle: async () => {},
  };
  const html = renderToStaticMarkup(React.createElement(CorpusBrowser, { scope: "ai", shortlist }));

  assert.match(html, /aria-label="Publikationsansicht"/);
  assert.match(html, />Neu seit letztem Lauf<\/button>/);
  assert.match(html, />Gesamter Korpus<\/button>/);
  assert.match(html, /Wochen-Shortlist/);
  assert.match(html, /Meine Shortlist \(0\)/);
  assert.match(html, /aria-label="Gesamten Korpus durchsuchen"/);
  assert.match(html, /aria-label="Suchschicht filtern"/);
  assert.match(html, /aria-label="Methode oder Studientyp nicht verfügbar"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />CSV<\/a>/);
  assert.match(html, />BibTeX<\/a>/);
});

test("publication cards expose provenance, evidence, data state and shortlist semantics", async () => {
  const { PublicationCard } = await vite.ssrLoadModule("/app/corpus-browser.tsx");
  const shortlist = {
    ids: new Set(["work-1"]),
    ready: true,
    saving: false,
    storage: "d1",
    error: null,
    toggle: async () => {},
  };
  const work = {
    id: "work-1",
    title: "Trust and human oversight",
    authors: ["A. Researcher"],
    publicationDate: "2026-08-20",
    onlineDate: null,
    source: "Human Factors",
    sourceType: "journal",
    sourceKind: "journal",
    url: "https://example.org/work-1",
    doi: "10.5555/work.1",
    abstract: "A controlled study of trust and human oversight.",
    citedBy: 12,
    relevanceScore: 88,
    isOpenAccess: true,
    openAccessStatus: "gold",
    topics: ["Human Factors"],
    keywords: ["trust"],
    retrievedAt: "2026-08-28T10:00:00.000Z",
    firstSeenAt: "2026-08-28T10:00:00.000Z",
    searchLayers: ["core"],
    themes: ["trust"],
    themeClassifications: [{
      theme: "trust",
      label: "Vertrauen",
      score: 7,
      evidence: [{ source: "title", matchedTerm: "trust", weight: 4 }],
      classificationVersion: "classification-v1",
      ontologyVersion: "ontology-v1",
    }],
    dataStatus: "partial",
    ingestionStatus: "partial",
    emergingSignal: { status: "watch", rank: 1 },
  };
  const html = renderToStaticMarkup(React.createElement(PublicationCard, { work, shortlist }));

  assert.match(html, /10\.5555\/work\.1/);
  assert.match(html, /A controlled study of trust/);
  assert.match(html, /Themenzuordnung · gespeicherte Evidenz/);
  assert.match(html, /Titel: „trust“ \(\+4\)/);
  assert.match(html, /Lauf teilweise/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aus Shortlist entfernen/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});
