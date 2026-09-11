import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateDataDirectory } from "../../scripts/validate-data.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const validFixture = path.join(projectRoot, "tests/fixtures/static-data/valid");
const invalidFixtures = path.join(projectRoot, "tests/fixtures/static-data/invalid");

test("rejects a search preview pointing to another publication page", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "radar-preview-"));
  try {
    await cp(validFixture, directory, { recursive: true });
    const filename = path.join(directory, "search-index.json");
    const search = JSON.parse(await readFile(filename, "utf8"));
    search.documents[0].summary = { id: search.documents[0].id, pagePath: "./works/page-999.json" };
    search.documents[0].pagePath = "./works/page-999.json";
    await writeFile(filename, JSON.stringify(search));
    const result = await validateDataDirectory(directory);
    assert.ok(result.errors.some(error => error.code === "inconsistent-summary"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function pointerParts(pointer) {
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function setPointer(document, pointer, value) {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  const parent = parts.reduce((current, part) => current[part], document);
  parent[key] = value;
}

function removePointer(document, pointer) {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  const parent = parts.reduce((current, part) => current[part], document);
  delete parent[key];
}

async function applyMutation(dataDirectory, mutation) {
  const target = path.join(dataDirectory, ...mutation.target.split("/"));
  const document = await readJson(target);
  for (const [pointer, value] of Object.entries(mutation.set ?? {})) setPointer(document, pointer, value);
  for (const pointer of mutation.remove ?? []) removePointer(document, pointer);
  if (mutation.operation === "duplicate-first-work") document.items.push(structuredClone(document.items[0]));
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

test("der vollständige gültige Fixture-Datensatz erfüllt alle Verträge", async () => {
  const result = await validateDataDirectory(validFixture);
  assert.equal(result.valid, true, result.errors.map((error) => JSON.stringify(error)).join("\n"));
  assert.equal(result.files.length, 10);
});

test("ungültige Fixtures werden mit den erwarteten Fehlerklassen abgelehnt", async (t) => {
  const fixtureNames = (await readdir(invalidFixtures)).filter((name) => name.endsWith(".json")).sort();
  assert.ok(fixtureNames.length >= 4);

  for (const fixtureName of fixtureNames) {
    await t.test(fixtureName, async (subtest) => {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "radar-data-validation-"));
      subtest.after(() => rm(temporaryRoot, { recursive: true, force: true }));
      await cp(validFixture, temporaryRoot, { recursive: true });
      const mutation = await readJson(path.join(invalidFixtures, fixtureName));
      await applyMutation(temporaryRoot, mutation);

      const result = await validateDataDirectory(temporaryRoot);
      const codes = new Set(result.errors.map((error) => error.code));
      assert.equal(result.valid, false);
      for (const expectedCode of mutation.expectedCodes) {
        assert.ok(codes.has(expectedCode), `${fixtureName}: ${expectedCode} fehlt; vorhanden: ${[...codes].join(", ")}`);
      }
    });
  }
});

test("alle JSON-Schemas sind parsebar, versioniert und referenzieren vorhandene lokale Schemas", async () => {
  const schemaDirectory = path.join(projectRoot, "schemas");
  const schemaNames = (await readdir(schemaDirectory)).filter((name) => name.endsWith(".schema.json")).sort();
  const schemas = new Map();
  assert.equal(schemaNames.length, 12);

  for (const schemaName of schemaNames) {
    const schema = await readJson(path.join(schemaDirectory, schemaName));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.$id, schemaName);
    schemas.set(schemaName, schema);
  }

  const refs = JSON.stringify([...schemas.values()]).match(/[a-z][a-z-]+\.schema\.json(?=#|\")/g) ?? [];
  for (const reference of refs) assert.ok(schemas.has(reference), `lokale Schema-Referenz fehlt: ${reference}`);
});

test("Produktionsdaten sind gültig und enthalten keine Fixture-Verweise", async () => {
  const productionData = path.join(projectRoot, "site/data");
  const result = await validateDataDirectory(productionData);
  assert.equal(result.valid, true, result.errors.map((error) => JSON.stringify(error)).join("\n"));

  for (const relativeFile of result.files) {
    const content = await readFile(path.join(productionData, ...relativeFile.split("/")), "utf8");
    assert.doesNotMatch(content, /tests[\\/]fixtures[\\/]/i);
  }
});
