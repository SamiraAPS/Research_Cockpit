import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deduplicateRecords, staticWorkToRecord } from "../../scripts/ingestion/deduplicate.mjs";
import { EXCERPT_LENGTH, abstractExcerpt, restrictAbstract, restrictAbstracts, restrictionMarkers } from "../../scripts/ingestion/restrict-abstracts.mjs";
import { rankLibrarySimilarity, textFingerprint, workText } from "../../scripts/similarity/rank.mjs";

const long = "Human supervisors of automated systems calibrate their trust over repeated interactions. ".repeat(12).trim();

test("excerpt is short, ends at a word and leaves short abstracts alone", () => {
  const excerpt = abstractExcerpt(long);
  assert.ok(excerpt.length <= EXCERPT_LENGTH + 2);
  assert.ok(excerpt.endsWith(" …"));
  assert.ok(long.startsWith(excerpt.slice(0, -2)));
  assert.doesNotMatch(excerpt.slice(0, -2), /\s$/);
  assert.equal(abstractExcerpt("Short abstract."), "Short abstract.");
  assert.equal(abstractExcerpt(null), "");
});

test("only works that are not open access are shortened, and only once", () => {
  const open = { id: "a", title: "Open", abstract: long, openAccess: true };
  assert.equal(restrictAbstract(open), open);
  const none = { id: "b", title: "No abstract", abstract: null, openAccess: false };
  assert.equal(restrictAbstract(none), none);

  for (const openAccess of [false, null]) {
    const closed = { id: "c", title: "Closed", abstract: long, openAccess };
    const restricted = restrictAbstract(closed);
    assert.equal(restricted.abstractRestricted, true);
    assert.equal(restricted.abstract, abstractExcerpt(long));
    assert.equal(restricted.abstractDigest, textFingerprint(workText(closed)), "digest is taken from the full text");
    assert.equal(restrictAbstract(restricted), restricted, "an excerpt is not shortened again");
  }
});

test("markers survive a rebuild while the excerpt is kept and go when the full text returns", () => {
  const stored = restrictAbstract({ id: "c", title: "Closed", abstract: long, openAccess: false });
  assert.deepEqual(restrictionMarkers([undefined, stored], stored.abstract), { abstractRestricted: true, abstractDigest: stored.abstractDigest });
  assert.deepEqual(restrictionMarkers([stored], long), {});
  assert.deepEqual(restrictionMarkers([{ abstract: stored.abstract }], stored.abstract), {});

  const work = {
    id: "doi:10.1000/closed", recordType: "publication", title: "Trust calibration in supervisory control", abstract: stored.abstract,
    abstractRestricted: true, abstractDigest: stored.abstractDigest, doi: "10.1000/closed", externalIds: { openalex: "W1" },
    source: { name: "OpenAlex", recordId: "W1" }, venue: "Human Factors", publicationDate: "2026-03-01", topics: [], keywords: [],
    classifiedThemes: [], scores: {}, evidenceTerms: [], authors: [{ name: "A. Author" }], url: "https://doi.org/10.1000/closed",
    openAccess: false, retrievedAt: "2026-11-01T00:00:00.000Z", firstSeenAt: "2026-11-01T00:00:00.000Z"
  };
  const [rebuilt] = deduplicateRecords([staticWorkToRecord(work)], { generatedAt: "2026-11-20T00:00:00.000Z" }).works;
  assert.equal(rebuilt.abstract, stored.abstract);
  assert.equal(rebuilt.abstractRestricted, true);
  assert.equal(rebuilt.abstractDigest, stored.abstractDigest);
  assert.equal(restrictAbstract(rebuilt), rebuilt);
});

test("the ranking keeps the vector of the full text after the abstract is shortened", async () => {
  const library = { profiles: [{ id: "trust", label: "Trust" }], seeds: [{ title: "Trust in automation", profiles: ["trust"] }] };
  const calls = [];
  const embed = async (texts) => { calls.push(...texts); return texts.map(text => Float32Array.from([text.length % 7 + 1, 1, text.length % 3 + 1])); };
  const full = { id: "c", title: "Closed", abstract: long, openAccess: false, firstSeenAt: "2026-11-01" };
  const cache = new Map();
  const before = await rankLibrarySimilarity({ works: [full], library, embed, cache, model: "stub" });
  const restricted = restrictAbstract(full);
  calls.length = 0;
  const after = await rankLibrarySimilarity({ works: [{ ...restricted }], library, embed, cache, model: "stub", previous: before });
  assert.deepEqual(calls, ["Trust in automation"], "only the library is embedded again");
  assert.equal(after.coverage.embeddedThisRun, 0);
  assert.deepEqual(after.scores.c, before.scores.c);
});

test("applies the policy to every works page of a data directory", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "abstract-policy-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "works"));
  const page = { schemaVersion: "works-page-1.1.0", items: [
    { id: "a", title: "Open", abstract: long, openAccess: true },
    { id: "c", title: "Closed", abstract: long, openAccess: false }
  ] };
  await writeFile(path.join(directory, "works", "page-001.json"), JSON.stringify(page));
  assert.deepEqual(await restrictAbstracts(directory), { policyVersion: "abstract-policy-1.0.0", totalWorks: 2, restrictedWorks: 1, changedThisRun: 1 });
  const written = JSON.parse(await readFile(path.join(directory, "works", "page-001.json"), "utf8"));
  assert.equal(written.items[0].abstract, long);
  assert.ok(written.items[1].abstract.length <= EXCERPT_LENGTH + 2);
  assert.equal((await restrictAbstracts(directory)).changedThisRun, 0, "a second pass changes nothing");
});
