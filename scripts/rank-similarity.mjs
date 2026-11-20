import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createEmbedder, DEFAULT_MODEL } from "./similarity/embedder.mjs";
import { buildLibraryGraph, resolveCitations } from "./similarity/graph.mjs";
import { embedLibrary, rankLibrarySimilarity } from "./similarity/rank.mjs";
import { loadVectorCache, saveVectorCache } from "./similarity/store.mjs";

const readJson = async file => JSON.parse(await readFile(file, "utf8"));

async function readWorks(dataDirectory) {
  const directory = path.join(dataDirectory, "works");
  const names = (await readdir(directory)).filter(name => /^page-\d+\.json$/.test(name)).sort();
  const pages = await Promise.all(names.map(name => readJson(path.join(directory, name))));
  return pages.flatMap(page => page.items.map(work => ({
    id: work.id, title: work.title, abstract: work.abstract, abstractDigest: work.abstractRestricted ? work.abstractDigest : undefined, firstSeenAt: work.firstSeenAt ?? work.retrievedAt, publicationDate: work.publicationDate
  })));
}

/**
 * Writes <dataDirectory>/similarity.json. New or changed works are embedded
 * newest first until the time budget is used up; the rest follows in later runs.
 */
export async function updateLibrarySimilarity(options = {}) {
  const dataDirectory = path.resolve(options.dataDirectory ?? "site/data");
  const cacheDirectory = path.resolve(options.cacheDirectory ?? "analysis-cache/similarity");
  const model = options.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();
  const [library, allWorks, previous] = await Promise.all([
    readJson(path.resolve(options.library ?? "config/reference-library.json")),
    readWorks(dataDirectory),
    readJson(path.join(dataDirectory, "similarity.json")).catch(error => { if (error.code === "ENOENT") return null; throw error; })
  ]);
  const works = options.limit ? allWorks.slice(0, options.limit) : allWorks;
  const embed = options.embed ?? await createEmbedder({ model });
  const cache = options.cache ?? await loadVectorCache(cacheDirectory, model);
  const seeds = await embedLibrary(library, embed);
  const similarity = await rankLibrarySimilarity({
    works, library, embed, cache, model, previous, seeds,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    deadline: startedAt + (options.minutes ?? 10) * 60_000
  });
  if (!options.cache) await saveVectorCache(cacheDirectory, model, cache);
  const outputDirectory = options.outputDirectory ? path.resolve(options.outputDirectory) : dataDirectory;
  const target = path.join(outputDirectory, "similarity.json");
  await writeFile(`${target}.tmp`, JSON.stringify(similarity));
  await rename(`${target}.tmp`, target);

  // Network of the library itself. Citation links come from OpenAlex and are refreshed weekly.
  const previousGraph = await readJson(path.join(dataDirectory, "library-graph.json")).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const citations = await resolveCitations(library.seeds, previousGraph, { apiKey: options.apiKey ?? process.env.OPENALEX_API_KEY, fetchImpl: options.fetchImpl, fetchRecords: options.fetchRecords });
  const graph = buildLibraryGraph({ library, ...seeds, citations, model, generatedAt: similarity.generatedAt });
  const graphTarget = path.join(outputDirectory, "library-graph.json");
  await writeFile(`${graphTarget}.tmp`, JSON.stringify(graph));
  await rename(`${graphTarget}.tmp`, graphTarget);
  const graphReport = { citations: { status: citations.status, resolvedWorks: citations.resolved, requestedWorks: citations.requested, links: graph.edges.citations.length, message: citations.message }, similarityLinks: graph.edges.similarity.length, authorLinks: graph.edges.authors.length };
  return { ...similarity.coverage, model, thresholds: similarity.thresholds, graph: graphReport, seconds: Math.round((Date.now() - startedAt) / 1000), file: target, similarity };
}

function sampleReport(similarity, works, graph, perProfile = 8) {
  const byId = new Map(works.map(work => [work.id, work]));
  const lines = [];
  if (graph) {
    lines.push("\n## Netzwerk der Referenzbibliothek");
    for (const [mode, edges] of Object.entries(graph.edges)) {
      const degree = new Array(graph.nodes.length).fill(0);
      for (const [a, b] of edges) { degree[a] += 1; degree[b] += 1; }
      const hubs = [...degree.keys()].sort((a, b) => degree[b] - degree[a]).slice(0, 6).filter(index => degree[index] > 0);
      lines.push(`- ${graph.modes[mode].label}: ${edges.length} Verbindungen, ${degree.filter(value => value === 0).length} Arbeiten ohne Verbindung${graph.modes[mode].message ? ` (${graph.modes[mode].message})` : ""}`);
      hubs.forEach(index => lines.push(`  - ${degree[index]} · ${graph.nodes[index].label.slice(0, 100)}`));
    }
  }
  similarity.profiles.forEach((profile, position) => {
    lines.push(`\n## ${profile.label} (${profile.seedCount} Referenzen)`);
    Object.entries(similarity.scores).filter(([, value]) => value[1] === position).sort((a, b) => b[1][0] - a[1][0]).slice(0, perProfile)
      .forEach(([id, [score, , seed]]) => lines.push(`- ${score.toFixed(3)} · ${byId.get(id)?.title?.slice(0, 110)}  ⟵ ${similarity.seeds[seed]?.slice(0, 70)}`));
  });
  const lowest = Object.entries(similarity.scores).sort((a, b) => a[1][0] - b[1][0]).slice(0, perProfile);
  lines.push("\n## Am weitesten entfernt");
  lowest.forEach(([id, [score]]) => lines.push(`- ${score.toFixed(3)} · ${byId.get(id)?.title?.slice(0, 110)}`));
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
  const number = key => args[key] === undefined ? undefined : Number(args[key]);
  updateLibrarySimilarity({ dataDirectory: args["data-dir"], cacheDirectory: args["cache-dir"], outputDirectory: args["output-dir"], model: args.model, minutes: number("minutes"), limit: number("limit") })
    .then(async ({ similarity, ...report }) => {
      console.log(JSON.stringify(report, null, 2));
      if (args.sample) {
        const graph = await readJson(path.join(path.dirname(report.file), "library-graph.json")).catch(() => null);
        console.log(sampleReport(similarity, await readWorks(path.resolve(args["data-dir"] ?? "site/data")), graph));
      }
    })
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
