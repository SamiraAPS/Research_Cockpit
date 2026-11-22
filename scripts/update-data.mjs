import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runStaticIngestion } from "./ingestion/pipeline.mjs";
import { runCallsIngestion } from "./calls/pipeline.mjs";
import { runAnalysisPipeline } from "./analysis/pipeline.mjs";
import { validateDataDirectory } from "./validate-data.mjs";
import { resolveConferences } from "./ingestion/conferences.mjs";
import { fetchFieldCounts } from "./ingestion/field-counts.mjs";
import { restrictAbstracts } from "./ingestion/restrict-abstracts.mjs";
import { limitCorpus } from "./ingestion/corpus-limit.mjs";
import { updateLibrarySimilarity } from "./rank-similarity.mjs";

// Never fatal: without the limit the corpus is merely larger than it needs to be.
async function applyLimit(stage) {
  try { return await limitCorpus(stage); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Korpusgrenze übersprungen: ${reason}`);
    return { applied: false, reason };
  }
}

// Stage a whole generation; never replace the last usable dataset with half-written files.
export async function updateData(options = {}) {
  const target = path.resolve(options.dataDirectory ?? "site/data");
  const stageRoot = await mkdtemp(path.join(path.dirname(target), ".radar-update-"));
  if (path.dirname(stageRoot) !== path.dirname(target) || !path.basename(stageRoot).startsWith(".radar-update-")) throw new Error("Unsafe staging directory");
  const stage = path.join(stageRoot, "data");
  const backup = path.join(stageRoot, "previous");
  await cp(target, stage, { recursive: true });
  let published = false;
  try {
    const baseMeta = JSON.parse(await readFile(path.join(stage, "meta.json"), "utf8"));
    const conferenceRegistry = await resolveConferences(baseMeta.conferenceRegistry, { apiKey: process.env.OPENALEX_API_KEY, now: options.now, fetchImpl: options.fetchImpl });
    const publications = await runStaticIngestion({
      ...options, mode: options.mode ?? "all", days: options.days ?? 90,
      dataDirectory: stage, maxPages: options.maxPages ?? 5, splitLanes: !options.range, resume: false,
      timeoutMs: options.timeoutMs ?? 20000, maxAttempts: 3,
      apiKey: process.env.OPENALEX_API_KEY, mailto: process.env.CROSSREF_MAILTO,
      crossref: options.crossref ?? false,
      conferenceSourceIds: conferenceRegistry.sources.map(source => source.id)
    });
    const refreshedMeta = JSON.parse(await readFile(path.join(stage, "meta.json"), "utf8"));
    refreshedMeta.conferenceRegistry = conferenceRegistry;
    refreshedMeta.fieldCounts = await fetchFieldCounts(baseMeta.fieldCounts, { apiKey: process.env.OPENALEX_API_KEY, now: options.now, fetchImpl: options.fetchImpl });
    await writeFile(path.join(stage, "meta.json"), JSON.stringify(refreshedMeta, null, 2));
    const calls = await runCallsIngestion({ dataDirectory: stage, timeoutMs: 12000, maxAttempts: 2 });
    // Works dropped in an earlier run are removed again before they cost ranking time.
    let corpusLimit = await applyLimit(stage);
    // Optional and never fatal: without a model the previous ranking stays in place.
    let similarity = "skipped";
    if (options.similarity ?? process.env.SIMILARITY_MODEL) {
      try {
        const ranked = await updateLibrarySimilarity({ dataDirectory: stage, model: process.env.SIMILARITY_MODEL, minutes: options.similarityMinutes, ...(options.similarity === true ? {} : options.similarity) });
        similarity = { model: ranked.model, totalWorks: ranked.totalWorks, scoredWorks: ranked.scoredWorks, embeddedThisRun: ranked.embeddedThisRun, pendingWorks: ranked.pendingWorks, graph: ranked.graph, seconds: ranked.seconds };
      } catch (error) {
        similarity = { failed: error instanceof Error ? error.message : String(error) };
        console.warn(`Bibliotheks-Ranking übersprungen: ${similarity.failed}`);
      }
    }
    // Newly ranked works that are too far from the library leave the corpus here.
    if (similarity !== "skipped" && !similarity.failed) {
      const after = await applyLimit(stage);
      corpusLimit = after.applied && corpusLimit.applied ? { ...after, droppedThisRun: after.droppedThisRun + corpusLimit.droppedThisRun } : after;
    }
    // After the ranking has seen the full text and before anything is analysed or
    // published: works that are not open access keep an excerpt of their abstract only.
    const abstracts = await restrictAbstracts(stage);
    await runAnalysisPipeline({ dataDirectory: stage });
    const validation = await validateDataDirectory(stage);
    if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    await rename(target, backup);
    try { await rename(stage, target); published = true; }
    catch (error) { await rename(backup, target); throw error; }
    const report = { publications: publications.status, calls: calls.status, works: corpusLimit.applied ? corpusLimit.keptWorks : publications.counts.canonicalWorks, collected: publications.counts.canonicalWorks, corpusLimit, similarity, abstracts, validated: true };
    await mkdir("work", { recursive: true });
    await writeFile("work/update-report.json", JSON.stringify(report, null, 2));
    return report;
  } finally {
    // The backup is removed only after the validated generation has been installed.
    if (published || !await readFile(path.join(backup, "meta.json")).then(() => true, () => false)) {
      await rm(stageRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
  const numeric = (key, fallback) => {
    const n = Number(args[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${key}`);
    return n;
  };
  const range = args.from ? { from: args.from, to: args.to ?? new Date().toISOString().slice(0, 10) } : undefined;
  updateData({ similarityMinutes: args["similarity-minutes"] ? numeric("similarity-minutes", 10) : undefined, dataDirectory: args.output, mode: args.mode ?? "all", days: numeric("days", 90), maxPages: numeric("max-pages", 5), range, resume: !range })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
