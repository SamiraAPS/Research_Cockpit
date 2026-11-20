import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createEmbedder, DEFAULT_MODEL } from "./similarity/embedder.mjs";
import { rankLibrarySimilarity } from "./similarity/rank.mjs";
import { loadVectorCache, saveVectorCache } from "./similarity/store.mjs";

const readJson = async file => JSON.parse(await readFile(file, "utf8"));

async function readWorks(dataDirectory) {
  const directory = path.join(dataDirectory, "works");
  const names = (await readdir(directory)).filter(name => /^page-\d+\.json$/.test(name)).sort();
  const pages = await Promise.all(names.map(name => readJson(path.join(directory, name))));
  return pages.flatMap(page => page.items.map(work => ({
    id: work.id, title: work.title, abstract: work.abstract, firstSeenAt: work.firstSeenAt ?? work.retrievedAt, publicationDate: work.publicationDate
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
  const similarity = await rankLibrarySimilarity({
    works, library, embed, cache, model, previous,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    deadline: startedAt + (options.minutes ?? 10) * 60_000
  });
  if (!options.cache) await saveVectorCache(cacheDirectory, model, cache);
  const target = path.join(options.outputDirectory ? path.resolve(options.outputDirectory) : dataDirectory, "similarity.json");
  await writeFile(`${target}.tmp`, JSON.stringify(similarity));
  await rename(`${target}.tmp`, target);
  return { ...similarity.coverage, model, thresholds: similarity.thresholds, seconds: Math.round((Date.now() - startedAt) / 1000), file: target, similarity };
}

function sampleReport(similarity, works, perProfile = 8) {
  const byId = new Map(works.map(work => [work.id, work]));
  const lines = [];
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
      if (args.sample) console.log(sampleReport(similarity, await readWorks(path.resolve(args["data-dir"] ?? "site/data"))));
    })
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
