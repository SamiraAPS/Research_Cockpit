// Diagnostic for the citation search: resolves the library references at
// OpenAlex, runs the search for one window and prints how many works it finds
// and keeps. Optionally reports which library references given DOIs cite.
//   node scripts/check-citation-search.mjs --from=2026-11-06 --to=2026-11-20 --doi=10.1287/orsc.2022.16738
import { readFile } from "node:fs/promises";

import { CITATION_SEARCH } from "./ingestion/config.mjs";
import { fetchWithRetry } from "./ingestion/http.mjs";
import { libraryCitations } from "./ingestion/normalize.mjs";
import { ingestOpenAlex } from "./ingestion/openalex.mjs";
import { citationEdges, fetchSeedRecords } from "./similarity/graph.mjs";
import { seedLabel } from "./similarity/rank.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
const apiKey = process.env.OPENALEX_API_KEY;
const library = JSON.parse(await readFile(args.library ?? "config/reference-library.json", "utf8"));
const { records } = await fetchSeedRecords(library.seeds, { apiKey });
const { ids } = citationEdges(library.seeds, records);
const libraryIds = new Map(ids.flatMap((id, index) => id && library.seeds[index].doi ? [[id, String(library.seeds[index].doi).toLowerCase()]] : []));
const labelByDoi = new Map(library.seeds.filter(seed => seed.doi).map(seed => [String(seed.doi).toLowerCase(), seedLabel(seed).split(":")[0]]));
console.log(`## Zitationssuche\n- ${libraryIds.size} von ${library.seeds.length} Referenzen bei OpenAlex gefunden`);

for (const doi of (args.doi ?? "").split(";").filter(Boolean)) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `doi:${doi}`);
  url.searchParams.set("select", "id,doi,display_name,publication_date,referenced_works");
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const { response } = await fetchWithRetry(url, { source: "OpenAlex", maxAttempts: 3 });
  const [work] = (await response.json()).results ?? [];
  if (!work) { console.log(`- ${doi}: bei OpenAlex nicht gefunden`); continue; }
  const cited = libraryCitations(work.referenced_works, libraryIds);
  console.log(`- ${doi} · ${work.display_name} (${work.publication_date}): ${work.referenced_works?.length ?? 0} Literaturangaben, davon ${cited.length} aus der Bibliothek${cited.length ? `: ${cited.map(d => labelByDoi.get(d)).join("; ")}` : ""}`);
}

const range = { from: args.from ?? new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10), to: args.to ?? new Date().toISOString().slice(0, 10) };
const all = [...libraryIds.keys()];
let found = 0;
const kept = new Map();
for (let offset = 0, batch = 1; offset < all.length; offset += CITATION_SEARCH.batchSize, batch += 1) {
  const citedWorkIds = all.slice(offset, offset + CITATION_SEARCH.batchSize);
  const { records: rows, stats } = await ingestOpenAlex("citation", { citedWorkIds, libraryIds, apiKey, range, maxPages: Number(args.pages ?? 6), minCited: args.min ? Number(args.min) : undefined });
  found += stats.foundCount;
  for (const row of rows) kept.set(row.sourceRecordId, row);
  console.log(`- Stapel ${batch}: ${stats.foundCount} zitierende Arbeiten gefunden, ${stats.pageCount} Seiten gelesen, ${rows.length} behalten, Status ${stats.status}${stats.message ? ` (${stats.message})` : ""}`);
}
console.log(`\n**${range.from} bis ${range.to}:** ${found} Treffer über alle Stapel, ${kept.size} verschiedene Arbeiten zitieren mindestens ${CITATION_SEARCH.minCited} Referenzen.`);
const histogram = new Map();
for (const row of kept.values()) histogram.set(row.libraryCitations.length, (histogram.get(row.libraryCitations.length) ?? 0) + 1);
console.log(`Verteilung (zitierte Referenzen → Arbeiten): ${[...histogram].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n} → ${c}`).join(", ")}`);
console.log("\n### Arbeiten mit den meisten zitierten Referenzen");
for (const row of [...kept.values()].sort((a, b) => b.libraryCitations.length - a.libraryCitations.length).slice(0, 25)) {
  console.log(`- ${row.libraryCitations.length} · ${row.title.slice(0, 110)} (${row.venue ?? "ohne Venue"}) ⟵ ${row.libraryCitations.slice(0, 4).map(d => labelByDoi.get(d)).join("; ")}`);
}
console.log("\n### Zufällige Auswahl mit genau 2 zitierten Referenzen");
for (const row of [...kept.values()].filter(row => row.libraryCitations.length === 2).slice(0, 15)) {
  console.log(`- ${row.title.slice(0, 110)} (${row.venue ?? "ohne Venue"}) ⟵ ${row.libraryCitations.map(d => labelByDoi.get(d)).join("; ")}`);
}
