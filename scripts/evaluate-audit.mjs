import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length) rows.push([...row, field]);
  const headers = rows.shift() ?? [];
  return rows.map(values => Object.fromEntries(headers.map((name, i) => [name.replace(/^\uFEFF/, ''), values[i] ?? ''])));
}

export function evaluateAudit(rows, { independentBenchmark = false } = {}) {
  const reviewed = rows.filter(row => row.review_status === "manually_verified" && row.reviewer?.trim());
  const decided = reviewed.filter(row => ["relevant", "irrelevant"].includes(row.manual_label));
  const retrieved = decided.filter(row => row.retrieved === "true");
  const relevant = decided.filter(row => row.manual_label === "relevant");
  const truePositives = relevant.filter(row => row.retrieved === "true").length;
  const perTheme = {};
  for (const row of reviewed.filter(row => row.manual_themes.trim())) {
    const predicted = new Set(row.predicted_themes.split(';').filter(Boolean));
    const expected = new Set(row.manual_themes.split(';').filter(t => t && t !== 'none'));
    for (const theme of new Set([...predicted, ...expected])) {
      const entry = perTheme[theme] ??= { tp: 0, fp: 0, fn: 0 };
      if (predicted.has(theme) && expected.has(theme)) entry.tp++;
      else if (predicted.has(theme)) entry.fp++; else entry.fn++;
    }
  }
  return {
    reviewed: reviewed.length,
    precision: retrieved.length ? truePositives / retrieved.length : null,
    recall: independentBenchmark && relevant.length ? truePositives / relevant.length : null,
    recallReason: independentBenchmark ? "Independent benchmark declared by reviewer" : "Retrieved-only audits cannot estimate recall; an independently assembled benchmark is required.",
    perTheme: Object.fromEntries(Object.entries(perTheme).map(([theme, c]) => [theme, { ...c,
      precision: c.tp + c.fp ? c.tp / (c.tp + c.fp) : null,
      recall: c.tp + c.fn ? c.tp / (c.tp + c.fn) : null
    }]))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node scripts/evaluate-audit.mjs reviewed.csv [--independent-benchmark]");
  const result = evaluateAudit(parseCsv(await readFile(file, "utf8")), { independentBenchmark: process.argv.includes("--independent-benchmark") });
  await writeFile("evaluation/latest-audit.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
