import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditCsv, csvCell } from "../site/assets/js/research.js";

export function stratifiedSample(works, size = 250) {
  const hash = work => createHash("sha256").update(`${work.title.toLowerCase()}:${work.authors?.[0]?.name ?? ""}`).digest("hex");
  const strata = new Map();
  for (const work of works) {
    const key = [work.recordType, work.publicationDate?.slice(0, 4), work.research?.relevance.status ?? "unknown", work.abstract ? "abstract" : "no-abstract"].join(":");
    const list = strata.get(key) ?? []; list.push(work); strata.set(key, list);
  }
  const queues = [...strata].sort(([a], [b]) => a.localeCompare(b)).map(([stratum, list]) => ({ stratum, population: list.length, works: list.sort((a, b) => hash(a).localeCompare(hash(b))) }));
  const output = [];
  while (output.length < size && queues.some(q => q.works.length)) {
    for (const queue of queues) if (queue.works.length && output.length < size) {
      const work = queue.works.shift();
      output.push({ work, stratum: queue.stratum, stratumPopulation: queue.population, split: parseInt(hash(work).slice(0, 4), 16) % 5 === 0 ? "held-out" : "development" });
    }
  }
  return output;
}

export async function prepareReview(dataDir = "site/data", output = "evaluation/pilot-review.csv") {
  const names = (await readdir(path.join(dataDir, "works"))).filter(name => /^page-\d+\.json$/.test(name)).sort();
  const works = (await Promise.all(names.map(name => readFile(path.join(dataDir, "works", name), "utf8").then(JSON.parse)))).flatMap(page => page.items);
  const selected = stratifiedSample(works);
  const header = auditCsv([]) + ',"split","stratum","stratum_population"';
  const rows = selected.map(({ work, split, stratum, stratumPopulation }) => auditCsv([work]).slice(auditCsv([]).length + 2) + [split, stratum, stratumPopulation].map(value => `,${csvCell(value)}`).join(""));
  await mkdir(path.dirname(output), { recursive: true });
  // Never overwrite a possibly annotated review file.
  await writeFile(output, [header, ...rows].join("\r\n"), { flag: "wx" });
  return { rows: selected.length, heldOut: selected.filter(row => row.split === "held-out").length, output };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(await prepareReview(process.argv[2], process.argv[3]));
