import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Embedding cache: one byte vector per work plus the fingerprint of the text it
// was computed from. It lives outside site/data and is never published.
const INDEX_FILE = "index.json";
const VECTOR_FILE = "vectors.bin";
const STORE_VERSION = "similarity-cache-1.0.0";

export async function loadVectorCache(directory, model) {
  const cache = new Map();
  try {
    const index = JSON.parse(await readFile(path.join(directory, INDEX_FILE), "utf8"));
    if (index.version !== STORE_VERSION || index.model !== model || !Number.isInteger(index.dimension) || index.dimension < 2) return cache;
    const bytes = await readFile(path.join(directory, VECTOR_FILE));
    if (!Array.isArray(index.ids) || !Array.isArray(index.fingerprints) || index.ids.length !== index.fingerprints.length) return cache;
    if (bytes.length !== index.ids.length * index.dimension) return cache;
    index.ids.forEach((id, position) => {
      const start = position * index.dimension;
      cache.set(id, { fingerprint: index.fingerprints[position], vector: new Int8Array(bytes.buffer, bytes.byteOffset + start, index.dimension).slice() });
    });
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return cache;
}

export async function saveVectorCache(directory, model, cache) {
  await mkdir(directory, { recursive: true });
  const ids = [...cache.keys()];
  const dimension = ids.length ? cache.get(ids[0]).vector.length : 0;
  const bytes = Buffer.alloc(ids.length * dimension);
  ids.forEach((id, position) => {
    const { vector } = cache.get(id);
    if (vector.length !== dimension) throw new Error("Uneinheitliche Vektorlänge im Embedding-Cache");
    bytes.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.length), position * dimension);
  });
  const index = { version: STORE_VERSION, model, dimension, ids, fingerprints: ids.map(id => cache.get(id).fingerprint) };
  for (const [name, content] of [[VECTOR_FILE, bytes], [INDEX_FILE, JSON.stringify(index)]]) {
    const target = path.join(directory, name);
    await writeFile(`${target}.tmp`, content);
    await rename(`${target}.tmp`, target);
  }
}
