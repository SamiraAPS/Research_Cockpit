import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { acceptedSemanticEntry, extractWithLocalModel } from "./analysis/semantic.mjs";
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dataDir = option("data-dir", "site/data");
const output = option("output", "analysis-cache/semantic.json");
const maximum = Number(option("limit", "20"));
if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid --limit");
const cache = await readFile(output, "utf8").then(JSON.parse, error => { if (error.code === "ENOENT") return { entries: {} }; throw error; });
const names = (await readdir(path.join(dataDir, "works"))).filter(name => /^page-\d+\.json$/.test(name)).sort();
const works = (await Promise.all(names.map(name => readFile(path.join(dataDir, "works", name), "utf8").then(JSON.parse)))).flatMap(page => page.items);
const pending = works.filter(work => work.abstract && work.research?.relevance.status !== "excluded" && !acceptedSemanticEntry(work, cache.entries[work.id])).sort((a, b) => (b.research?.personalFit.length ?? 0) - (a.research?.personalFit.length ?? 0)).slice(0, maximum);
await mkdir(path.dirname(output), { recursive: true });
for (const work of pending) {
  cache.entries[work.id] = await extractWithLocalModel(work, { model: process.env.RESEARCH_MODEL, embeddingModel: process.env.RESEARCH_EMBED_MODEL, endpoint: process.env.RESEARCH_MODEL_URL });
  await writeFile(`${output}.tmp`, JSON.stringify(cache)); await rename(`${output}.tmp`, output);
  console.log(`Textbelege geprüft: ${work.id}`);
}
console.log(JSON.stringify({ processed: pending.length, cached: Object.keys(cache.entries).length, interpretationHumanValidated: false }));
