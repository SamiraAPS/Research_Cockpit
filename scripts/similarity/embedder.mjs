import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Sentence embeddings from a small open model that runs on the CPU of the
// GitHub runner. The library is installed by the workflow into its own folder
// (SIMILARITY_MODULE_DIR) so the dashboard's own dependencies stay unchanged.
export const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

async function loadTransformers(moduleDirectory) {
  if (!moduleDirectory) return import("@huggingface/transformers");
  const require = createRequire(path.join(path.resolve(moduleDirectory), "package.json"));
  return import(pathToFileURL(require.resolve("@huggingface/transformers")).href);
}

export async function createEmbedder({ model = DEFAULT_MODEL, moduleDirectory = process.env.SIMILARITY_MODULE_DIR } = {}) {
  const { pipeline } = await loadTransformers(moduleDirectory);
  const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
  return async function embed(texts) {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const [count, dimension] = output.dims;
    if (count !== texts.length) throw new Error("Embedding-Modell lieferte eine unerwartete Anzahl Vektoren");
    return Array.from({ length: count }, (_, row) => output.data.slice(row * dimension, (row + 1) * dimension));
  };
}
