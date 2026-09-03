import path from "node:path";

import { runCallsIngestion } from "./calls/pipeline.mjs";

function args(argv) {
  const options = { sourceKeys: [] };
  for (const argument of argv) {
    if (argument === "--help") options.help = true;
    else if (argument.startsWith("--source=")) options.sourceKeys.push(...argument.slice(9).split(",").filter(Boolean));
    else if (argument.startsWith("--data-dir=")) options.dataDirectory = path.resolve(argument.slice(11));
    else if (argument.startsWith("--timeout-ms=")) options.timeoutMs = Number(argument.slice(13));
    else if (argument.startsWith("--max-attempts=")) options.maxAttempts = Number(argument.slice(15));
    else if (argument.startsWith("--concurrency=")) options.concurrency = Number(argument.slice(14));
    else throw new Error(`Unbekanntes Argument: ${argument}`);
  }
  return options;
}

const options = args(process.argv.slice(2));
if (options.help) {
  console.log("Usage: node scripts/ingest-calls.mjs [--source=KEY[,KEY]] [--data-dir=PATH] [--timeout-ms=N] [--max-attempts=N] [--concurrency=N]");
} else {
  const report = await runCallsIngestion(options);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "unavailable") process.exitCode = 1;
}
