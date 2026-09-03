import path from "node:path";
import { pathToFileURL } from "node:url";

import { runAnalysisPipeline } from "./analysis/pipeline.mjs";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export async function main() {
  const dataDirectory = path.resolve(option("data-dir") ?? "site/data");
  const result = await runAnalysisPipeline({ dataDirectory, generatedAt: option("at") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
