import path from "node:path";

import { validateDataDirectory } from "./validate-data.mjs";
import { runStaticIngestion } from "./ingestion/pipeline.mjs";

function usage() {
  return `Statische Publikations-Ingestion

Aufruf:
  node scripts/ingest.mjs [Optionen]

Optionen:
  --mode <core|broad|frontier|all>  Suchmodus (Standard: all)
  --days <n>                       Veröffentlichungsfenster in Tagen (Standard: 90)
  --output <pfad>                  Datenverzeichnis (Standard: site/data)
  --timeout-ms <n>                 Timeout je HTTP-Anfrage
  --page-size <n>                  Einträge je statischer Works-Datei
  --skip-crossref                  DOI-Enrichment für diesen Lauf auslassen
  --help                           Diese Hilfe anzeigen

Optionale Umgebung:
  OPENALEX_API_KEY, CROSSREF_MAILTO`;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} muss eine positive ganze Zahl sein`);
  return parsed;
}

function parseArguments(args) {
  const options = {
    mode: "all",
    days: 90,
    dataDirectory: "site/data",
    crossref: true
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [flag, inlineValue] = argument.split("=", 2);
    const takeValue = () => inlineValue ?? args[++index];
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--skip-crossref") options.crossref = false;
    else if (flag === "--mode") options.mode = takeValue();
    else if (flag === "--days") options.days = positiveInteger(takeValue(), "--days");
    else if (flag === "--output") options.dataDirectory = takeValue();
    else if (flag === "--timeout-ms") options.timeoutMs = positiveInteger(takeValue(), "--timeout-ms");
    else if (flag === "--page-size") options.pageSize = positiveInteger(takeValue(), "--page-size");
    else throw new Error(`Unbekannte Option ${argument}`);
  }
  if (!options.dataDirectory) throw new Error("--output benötigt einen Pfad");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  options.dataDirectory = path.resolve(options.dataDirectory);
  options.apiKey = process.env.OPENALEX_API_KEY;
  options.mailto = process.env.CROSSREF_MAILTO;
  const report = await runStaticIngestion(options);
  const validation = await validateDataDirectory(options.dataDirectory);
  report.validation = {
    valid: validation.valid,
    files: validation.files.length,
    errors: validation.errors
  };
  console.log(JSON.stringify(report, null, 2));
  if (!validation.valid) process.exitCode = 1;
  else if (report.status !== "ready") process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
