import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  }));
  return nested.flat();
}

test("contains no committed environment files or credential-shaped literals", async () => {
  const rootEntries = await readdir(root);
  assert.deepEqual(rootEntries.filter((name) => /^\.env(?:\.|$)/.test(name)), []);

  const productionFiles = (await Promise.all(["app", "lib", "db", "scripts", ".openai"].map((directory) => filesBelow(path.join(root, directory))))).flat();
  const textFiles = productionFiles.filter((filename) => /\.(?:ts|tsx|js|mjs|json|sh|md)$/.test(filename));
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /Authorization\s*:\s*["']Bearer\s+(?!<)[A-Za-z0-9._-]{12,}/i,
    /(?:INGESTION_TOKEN|OPENALEX_API_KEY)\s*=\s*["'][^"']{8,}["']/,
  ];
  for (const filename of textFiles) {
    const contents = await readFile(filename, "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(contents, pattern, path.relative(root, filename));
    if (/[\\/]app[\\/]|[\\/]lib[\\/]/.test(filename)) {
      assert.doesNotMatch(contents, /tests[\\/]fixtures|example\.org/i, `${path.relative(root, filename)} imports test or example data`);
    }
  }

  const hosting = JSON.parse(await readFile(path.join(root, ".openai", "hosting.json"), "utf8"));
  assert.ok(Object.keys(hosting).every((key) => ["project_id", "d1", "r2"].includes(key)));
  assert.equal(hosting.d1, "DB");
});

test("keeps the versioned gold standard empty until manual review", async () => {
  const csv = await readFile(path.join(root, "evaluation", "gold-standard.csv"), "utf8");
  const rows = csv.trim().split(/\r?\n/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0], "id,title,expected_relevance,retrieved,review_status,reviewer_note");
  const schema = JSON.parse(await readFile(path.join(root, "evaluation", "gold-standard.schema.json"), "utf8"));
  assert.deepEqual(schema.properties.expectedRelevance.enum, ["relevant", "irrelevant", "unclear"]);
  assert.equal(schema.properties.reviewStatus.const, "manually_verified");
});

test("packages Drizzle migrations for the local D1 binding", async () => {
  const viteConfig = await readFile(path.join(root, "vite.config.ts"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  assert.match(viteConfig, /binding:\s*d1/);
  assert.match(viteConfig, /migrations_dir:\s*"\.\.\/\.openai\/drizzle"/);
  assert.match(viteConfig, /vars:\s*command === "serve" \? localRuntimeVariables\(\) : \{\}/);
  assert.match(viteConfig, /"INGESTION_TOKEN"/);
  assert.match(packageJson.scripts["db:migrate:local"], /wrangler d1 migrations apply DB --local/);
  assert.match(packageJson.scripts["db:migrate:local"], /--persist-to \.wrangler\/state(?:\s|$)/);
  assert.doesNotMatch(packageJson.scripts["db:migrate:local"], /--persist-to \.wrangler\/state\/v3/);
  assert.match(packageJson.scripts["db:migrate:local"], /--config dist\/server\/wrangler\.json/);
});

test("built Wrangler config resolves the complete migration chain without secrets", async () => {
  const wranglerPath = path.join(root, "dist", "server", "wrangler.json");
  const wrangler = JSON.parse(await readFile(wranglerPath, "utf8"));
  const binding = wrangler.d1_databases.find((database) => database.binding === "DB");

  assert.ok(binding, "dist/server/wrangler.json must expose the DB binding");
  assert.equal(binding.database_name, "site-creator-d1");
  assert.equal(wrangler.vars && Object.keys(wrangler.vars).length, 0, "production build must not contain runtime secrets");

  const migrationsDirectory = path.resolve(path.dirname(wranglerPath), binding.migrations_dir);
  const migrationFiles = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const journal = JSON.parse(await readFile(path.join(root, "drizzle", "meta", "_journal.json"), "utf8"));
  const journalFiles = journal.entries.map((entry) => `${entry.tag}.sql`);

  assert.deepEqual(migrationFiles, journalFiles);
  assert.equal(migrationFiles.length, 7);
});
