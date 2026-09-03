import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseOfficialCallSource } from "../../scripts/calls/adapters/index.mjs";
import { OFFICIAL_CALL_SOURCES, findOfficialCallSource } from "../../scripts/calls/config.mjs";
import { calculateCallStatus, mergeCalls } from "../../scripts/calls/merge.mjs";
import { runCallsIngestion } from "../../scripts/calls/pipeline.mjs";
import { runAnalysisPipeline } from "../../scripts/analysis/pipeline.mjs";
import { validateDataDirectory } from "../../scripts/validate-data.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const fixtureDirectory = path.join(projectRoot, "tests/fixtures");
const validStaticFixture = path.join(fixtureDirectory, "static-data/valid");
const fixedNow = new Date("2026-09-02T10:00:00Z");

const fixtureNames = {
  "acm-chi-2027": "calls-acm-chi-2027.html",
  "acm-cscw-rolling": "calls-cscw-rolling.html",
  "acm-iui-2027": "calls-acm-iui-2027.html",
  "acm-ieee-hri-2027": "calls-hri-2027.html",
  "acm-dis-2027": "calls-dis-2027.html",
  "hfes-aspire": "calls-hfes-aspire.html",
  "ahfe-2027": "calls-ahfe-2027.html",
  "sage-human-relations": "calls-sage-human-relations.html",
  "elsevier-safety-science": "calls-elsevier-safety-science.html",
  "elsevier-applied-ergonomics": "calls-elsevier-applied-ergonomics.html"
};

const fixtures = Object.fromEntries(await Promise.all(Object.entries(fixtureNames).map(async ([key, filename]) => [
  key,
  await readFile(path.join(fixtureDirectory, filename), "utf8")
])));

function fixtureFetch(overrides = {}) {
  return async (input) => {
    const url = new URL(String(input));
    const source = OFFICIAL_CALL_SOURCES.find((candidate) => new URL(candidate.officialUrl).toString() === url.toString());
    if (!source) throw new Error(`Unerwartete URL außerhalb der Registry: ${url}`);
    const override = overrides[source.key];
    if (override instanceof Response) return override;
    const html = typeof override === "string" ? override : fixtures[source.key];
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}

async function prepareData(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "radar-calls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(validStaticFixture, directory, { recursive: true });
  const metaPath = path.join(directory, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  meta.datasets.calls.recordCount = 0;
  meta.datasets.calls.status = "unavailable";
  meta.datasets.agendaSignals.recordCount = 0;
  meta.datasets.agendaSignals.status = "unavailable";
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "calls.json"), `${JSON.stringify({
    schemaVersion: "calls-1.1.0",
    generatedAt: "2026-08-31T12:00:00Z",
    status: "unavailable",
    registryVersion: "calls-registry-2.0.0",
    closingWindowDays: 30,
    counts: { totalStored: 0, active: 0, open: 0, closingSoon: 0, expired: 0, unverified: 0 },
    sourceStatus: [],
    items: []
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "agenda-signals.json"), `${JSON.stringify({
    schemaVersion: "agenda-signals-1.0.0",
    generatedAt: "2026-08-31T12:00:00Z",
    status: "unavailable",
    registryVersion: "calls-registry-2.0.0",
    interpretation: "Rohsignale aus offiziellen Call-Seiten; keine Publikationstrends und keine wissenschaftliche Evidenz.",
    items: []
  }, null, 2)}\n`, "utf8");
  return directory;
}

test("Registry enthält nur freigegebene HTTPS-Quellen für alle geforderten Venues", () => {
  const labels = OFFICIAL_CALL_SOURCES.map((source) => source.venue).join(" ");
  for (const venue of ["CHI", "CSCW", "PACMHCI", "IUI", "HRI", "DIS", "HFES", "AHFE", "Human Relations", "Safety Science", "Applied Ergonomics"]) {
    assert.match(labels, new RegExp(venue, "i"));
  }
  assert.equal(new Set(OFFICIAL_CALL_SOURCES.map((source) => source.key)).size, OFFICIAL_CALL_SOURCES.length);
  for (const source of OFFICIAL_CALL_SOURCES) {
    const url = new URL(source.officialUrl);
    assert.equal(url.protocol, "https:");
    assert.ok(source.allowedHosts.includes(url.hostname));
    assert.match(source.parserVersion, /-\d+\.\d+\.\d+$/);
  }
});

test("jeder Registry-Eintrag wird von seinem quellenspezifischen Fixture-Adapter geparst", () => {
  for (const source of OFFICIAL_CALL_SOURCES) {
    const parsed = parseOfficialCallSource(source, fixtures[source.key]);
    assert.ok(parsed.calls.length > 0, `${source.key} lieferte keinen Call`);
    assert.ok(parsed.agendaSignals.length > 0, `${source.key} lieferte kein Rohsignal`);
    for (const call of parsed.calls) {
      assert.equal(call.venue, source.venue);
      assert.ok(source.allowedHosts.includes(new URL(call.officialUrl).hostname));
      assert.ok(call.description.length > 0);
    }
  }
});

test("Statuslogik berechnet closing-soon, Ablauf und undatierte Calls transparent", () => {
  assert.equal(calculateCallStatus({ deadlineAt: "2026-09-10T23:59:59-12:00", eventDate: null }, fixedNow, true), "closing-soon");
  assert.equal(calculateCallStatus({ deadlineAt: "2026-08-20T23:59:59-12:00", eventDate: null }, fixedNow, true), "expired");
  assert.equal(calculateCallStatus({ deadlineAt: "2027-01-18T23:59:59-12:00", eventDate: null }, fixedNow, true), "open");
  assert.equal(calculateCallStatus({ deadlineAt: null, eventDate: null }, fixedNow, true), "unverified");
});

test("Deduplizierung vereint identische Call-IDs und hält nur eine kanonische Fassung", () => {
  const source = findOfficialCallSource("acm-dis-2027");
  const parsed = parseOfficialCallSource(source, fixtures[source.key]).calls[0];
  const candidate = { ...parsed, parserVersion: source.parserVersion, sourceVersion: source.sourceVersion, sourceKey: source.key, sourceName: source.name };
  const result = mergeCalls([], [candidate, structuredClone(candidate)], new Map([[source.key, { checked: true, status: "verified" }]]), fixedNow.toISOString());
  assert.equal(result.items.length, 1);
  assert.equal(result.stats.deduplicated, 1);
  assert.equal(result.items[0].versions.length, 1);
});

test("Fixture-Lauf schreibt valide Calls, Versionsdaten und getrennte Agenda-Rohsignale", async (t) => {
  const dataDirectory = await prepareData(t);
  const report = await runCallsIngestion({
    dataDirectory,
    now: fixedNow,
    fetchImpl: fixtureFetch(),
    sleep: async () => {},
    concurrency: 4
  });
  assert.equal(report.status, "ready");
  assert.equal(report.sources.length, OFFICIAL_CALL_SOURCES.length);
  assert.ok(report.counts.totalStored >= OFFICIAL_CALL_SOURCES.length);
  assert.ok(report.counts.agendaSignals >= OFFICIAL_CALL_SOURCES.length);
  const calls = JSON.parse(await readFile(path.join(dataDirectory, "calls.json"), "utf8"));
  const agenda = JSON.parse(await readFile(path.join(dataDirectory, "agenda-signals.json"), "utf8"));
  assert.ok(calls.items.every((call) => call.versions.length === 1));
  assert.ok(calls.items.some((call) => call.status === "expired"));
  assert.ok(calls.items.some((call) => call.status === "closing-soon"));
  assert.ok(calls.items.some((call) => call.status === "unverified"));
  assert.ok(agenda.items.every((entry) => !Object.hasOwn(entry, "html")));
  await runAnalysisPipeline({ dataDirectory, generatedAt: "2026-09-02T10:01:00Z" });
  const validation = await validateDataDirectory(dataDirectory);
  assert.equal(validation.valid, true, validation.errors.map((error) => JSON.stringify(error)).join("\n"));
});

test("Inhaltsänderung erzeugt eine Version; 403 erhält den Call und markiert die Quelle", async (t) => {
  const dataDirectory = await prepareData(t);
  const sourceKey = "sage-human-relations";
  await runCallsIngestion({ dataDirectory, sourceKeys: [sourceKey], now: fixedNow, fetchImpl: fixtureFetch(), sleep: async () => {} });
  const changedHtml = fixtures[sourceKey].replace("31st May 2027", "30th June 2027");
  await runCallsIngestion({
    dataDirectory,
    sourceKeys: [sourceKey],
    now: new Date("2026-09-03T10:00:00Z"),
    fetchImpl: fixtureFetch({ [sourceKey]: changedHtml }),
    sleep: async () => {}
  });
  let calls = JSON.parse(await readFile(path.join(dataDirectory, "calls.json"), "utf8"));
  const changed = calls.items.find((call) => call.deadlineAt?.startsWith("2027-06-30"));
  assert.equal(changed.versions.length, 2);
  assert.equal(changed.createdAt, fixedNow.toISOString());

  const forbidden = await runCallsIngestion({
    dataDirectory,
    sourceKeys: [sourceKey],
    now: new Date("2028-01-02T10:00:00Z"),
    fetchImpl: fixtureFetch({ [sourceKey]: new Response("Forbidden", { status: 403 }) }),
    sleep: async () => {}
  });
  assert.equal(forbidden.sources[0].status, "forbidden");
  assert.equal(forbidden.sources[0].httpStatus, 403);
  calls = JSON.parse(await readFile(path.join(dataDirectory, "calls.json"), "utf8"));
  assert.ok(calls.items.length >= 2);
  assert.ok(calls.items.every((call) => call.status === "expired"));
  assert.equal(calls.items.find((call) => call.id === changed.id).versions.length, 2);
});

test("Parserfehler erzeugt keine Ersatzcalls", async (t) => {
  const dataDirectory = await prepareData(t);
  const sourceKey = "hfes-aspire";
  const htmlWithoutYears = fixtures[sourceKey].replaceAll("2027", "year not announced");
  const report = await runCallsIngestion({
    dataDirectory,
    sourceKeys: [sourceKey],
    now: fixedNow,
    fetchImpl: fixtureFetch({ [sourceKey]: htmlWithoutYears }),
    sleep: async () => {}
  });
  assert.equal(report.sources[0].status, "parser_error");
  assert.equal(report.counts.totalStored, 0);
  const calls = JSON.parse(await readFile(path.join(dataDirectory, "calls.json"), "utf8"));
  assert.deepEqual(calls.items, []);
});
