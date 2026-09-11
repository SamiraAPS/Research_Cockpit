import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runStaticIngestion } from "./ingestion/pipeline.mjs";
import { runCallsIngestion } from "./calls/pipeline.mjs";
import { runAnalysisPipeline } from "./analysis/pipeline.mjs";
import { validateDataDirectory } from "./validate-data.mjs";

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
    const pendingBackfill = baseMeta.historicalBackfill && !baseMeta.historicalBackfill.complete;
    const publications = await runStaticIngestion({
      ...options, mode: options.mode ?? "all", days: options.days ?? 90,
      dataDirectory: stage, maxPages: options.maxPages ?? 5, resume: options.resume !== false,
      timeoutMs: options.timeoutMs ?? 20000, maxAttempts: 3,
      apiKey: process.env.OPENALEX_API_KEY, mailto: process.env.CROSSREF_MAILTO,
      crossref: options.crossref ?? false,
      ...(pendingBackfill ? { mode: "core", range: baseMeta.historicalBackfill.range, cursor: baseMeta.historicalBackfill.cursor, resume: false } : {})
    });
    if (pendingBackfill) {
      const meta = JSON.parse(await readFile(path.join(stage, "meta.json"), "utf8"));
      const progress = meta.ingestionProgress["openalex:core"];
      meta.historicalBackfill = { ...baseMeta.historicalBackfill, cursor: progress.complete ? null : progress.cursor ?? baseMeta.historicalBackfill.cursor, complete: progress.complete };
      await writeFile(path.join(stage, "meta.json"), JSON.stringify(meta, null, 2));
    }
    const calls = await runCallsIngestion({ dataDirectory: stage, timeoutMs: 12000, maxAttempts: 2 });
    await runAnalysisPipeline({ dataDirectory: stage });
    const validation = await validateDataDirectory(stage);
    if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    await rename(target, backup);
    try { await rename(stage, target); published = true; }
    catch (error) { await rename(backup, target); throw error; }
    const report = { publications: publications.status, calls: calls.status, works: publications.counts.canonicalWorks, validated: true };
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
  updateData({ dataDirectory: args.output, mode: args.mode ?? "all", days: numeric("days", 90), maxPages: numeric("max-pages", 5), range, resume: !range })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
