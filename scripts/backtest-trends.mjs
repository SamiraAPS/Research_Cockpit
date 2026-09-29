import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateHistoricalForecasts } from "./analysis/backtest.mjs";
const directory = process.argv[2] ?? "site/data";
const index = JSON.parse(await readFile(path.join(directory, "snapshots/index.json"), "utf8"));
const snapshots = await Promise.all(index.snapshots.map(async entry => {
  if (!/^\.\/snapshot-[^/]+\.json$/.test(entry.path)) throw new Error("Invalid snapshot path");
  return JSON.parse(await readFile(path.join(directory, "snapshots", entry.path), "utf8"));
}));
console.log(JSON.stringify(evaluateHistoricalForecasts(snapshots), null, 2));
