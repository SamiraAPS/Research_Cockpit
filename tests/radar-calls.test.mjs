import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { createTestD1 } from "./helpers/d1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = Object.fromEntries(await Promise.all([
  ["acm-chi-2027", "calls-acm-chi-2027.html"],
  ["ahfe-2027", "calls-ahfe-2027.html"],
  ["elsevier-safety-science", "calls-elsevier-safety-science.html"],
  ["sage-human-relations", "calls-sage-human-relations.html"],
].map(async ([key, filename]) => [key, await readFile(new URL(`./fixtures/${filename}`, import.meta.url), "utf8")])));

const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const { OFFICIAL_CALL_SOURCES, findCallSource } = await vite.ssrLoadModule("/lib/calls/config/sources.v1.ts");
const { parseOfficialCallSource, ParserContractError } = await vite.ssrLoadModule("/lib/calls/adapters/index.ts");
const { calculateCallStatus, isCallVisibleByDefault, sortCallsByDeadline } = await vite.ssrLoadModule("/lib/calls/status.ts");
const { runCallsIngestion } = await vite.ssrLoadModule("/lib/calls/ingestion.ts");
const { readCallsData } = await vite.ssrLoadModule("/lib/calls/repository.ts");
const { readRadarData } = await vite.ssrLoadModule("/lib/radar/repository.ts");

after(async () => {
  await vite.close();
});

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function fixtureFetch(sourceKey, html = fixtures[sourceKey]) {
  const source = findCallSource(sourceKey);
  return async (input) => {
    assert.equal(new URL(String(input)).hostname, new URL(source.url).hostname);
    return htmlResponse(html);
  };
}

test("source-specific adapters parse saved official fixtures", () => {
  const parsed = Object.fromEntries(OFFICIAL_CALL_SOURCES.map((source) => [
    source.key,
    parseOfficialCallSource(source, fixtures[source.key]),
  ]));

  assert.equal(parsed["acm-chi-2027"].calls.length, 2);
  assert.deepEqual(parsed["acm-chi-2027"].calls.map((call) => call.callType), ["conference", "workshop"]);
  assert.deepEqual(parsed["acm-chi-2027"].calls.map((call) => call.submissionDeadline), ["2026-09-10", "2026-10-01"]);
  assert.equal(parsed["ahfe-2027"].calls[0].eventOrPublicationDate, "2027-07-26");
  assert.equal(parsed["elsevier-safety-science"].calls[0].callType, "special_issue");
  assert.equal(parsed["sage-human-relations"].calls.length, 2);
  for (const source of OFFICIAL_CALL_SOURCES) {
    for (const call of parsed[source.key].calls) {
      assert.ok(source.allowedHosts.includes(new URL(call.officialUrl).hostname));
      assert.ok(call.themes.length > 0);
    }
  }
});

test("calculates expiration and closing status and sorts null deadlines last", () => {
  assert.equal(calculateCallStatus("2026-08-27", true, "2026-08-28T10:00:00.000Z"), "expired");
  assert.equal(calculateCallStatus("2026-09-10", true, "2026-08-28T10:00:00.000Z"), "closing");
  assert.equal(calculateCallStatus("2027-05-31", true, "2026-08-28T10:00:00.000Z"), "open");
  assert.equal(calculateCallStatus("2027-05-31", false, "2026-08-28T10:00:00.000Z"), "unverified");
  assert.equal(isCallVisibleByDefault({ status: "expired", submissionDeadline: "2026-08-27" }, "2026-08-28"), false);
  assert.equal(isCallVisibleByDefault({ status: "unverified", submissionDeadline: "2026-08-27" }, "2026-08-28"), false);
  assert.equal(isCallVisibleByDefault({ status: "open", submissionDeadline: "2027-05-31" }, "2026-08-28"), true);
  assert.deepEqual(sortCallsByDeadline([
    { title: "No date", submissionDeadline: null },
    { title: "Later", submissionDeadline: "2027-05-31" },
    { title: "Soon", submissionDeadline: "2026-09-10" },
  ]).map((call) => call.title), ["Soon", "Later", "No date"]);
});

test("marks changed official content for review and preserves immutable call history", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const sourceKey = "sage-human-relations";
  const first = await runCallsIngestion(db, { dataset: "calls", sourceKeys: [sourceKey] }, {
    fetchImpl: fixtureFetch(sourceKey), sleep: async () => {}, now: () => "2026-08-28T10:00:00.000Z",
  });
  assert.equal(first.status, "succeeded");
  assert.equal(first.newCount, 2);

  const changedHtml = fixtures[sourceKey].replace("31st May 2027", "30th June 2027");
  const changed = await runCallsIngestion(db, { dataset: "calls", sourceKeys: [sourceKey] }, {
    fetchImpl: fixtureFetch(sourceKey, changedHtml), sleep: async () => {}, now: () => "2026-08-29T10:00:00.000Z",
  });
  assert.equal(changed.status, "partial");
  assert.equal(changed.requiresManualReview, true);
  assert.equal(changed.sources[0].sourceStatus, "changed");
  const duringReview = await readCallsData(db, "2026-08-29T10:00:00.000Z");
  assert.ok(duringReview.calls.every((call) => call.status === "unverified"));
  assert.ok(duringReview.calls.every((call) => call.verifiedAt === "2026-08-28T10:00:00.000Z"));

  const approved = await runCallsIngestion(db, {
    dataset: "calls", sourceKeys: [sourceKey], approveChangedContent: true,
  }, {
    fetchImpl: fixtureFetch(sourceKey, changedHtml), sleep: async () => {}, now: () => "2026-08-30T10:00:00.000Z",
  });
  assert.equal(approved.status, "succeeded");
  const calls = await readCallsData(db, "2026-08-30T10:00:00.000Z");
  assert.equal(calls.calls[0].submissionDeadline, "2026-12-31");
  assert.ok(calls.calls.some((call) => call.submissionDeadline === "2027-06-30"));
  assert.ok(calls.calls.every((call) => call.status === "open" || call.status === "closing"));
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM calls").get().count, 2);
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS count FROM call_versions").get().count >= 4);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM call_ingestion_runs").get().count, 3);
});

test("flags parser-contract changes for manual review", async (context) => {
  const source = findCallSource("ahfe-2027");
  const changedHtml = fixtures["ahfe-2027"].replace("Summary of Submission Requirements &amp; Deadlines", "Dates overview");
  assert.throws(() => parseOfficialCallSource(source, changedHtml), ParserContractError);

  const db = await createTestD1(root);
  context.after(() => db.close());
  const result = await runCallsIngestion(db, { dataset: "calls", sourceKeys: [source.key] }, {
    fetchImpl: fixtureFetch(source.key, changedHtml), sleep: async () => {}, now: () => "2026-08-28T10:00:00.000Z",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.requiresManualReview, true);
  assert.equal(db.raw.prepare("SELECT status FROM call_source_state").get().status, "parser_error");
  assert.equal(db.raw.prepare("SELECT requires_manual_review FROM call_ingestion_runs").get().requires_manual_review, 1);
});

test("persists unavailable official sources without inventing calls", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const result = await runCallsIngestion(db, { dataset: "calls", sourceKeys: ["acm-chi-2027"] }, {
    fetchImpl: async () => new Response("Unavailable", { status: 503 }),
    sleep: async () => {},
    now: () => "2026-08-28T10:00:00.000Z",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.sources[0].sourceStatus, "unavailable");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM calls").get().count, 0);
  assert.equal(db.raw.prepare("SELECT status FROM call_source_state").get().status, "unavailable");
});

test("keeps prior calls as unverified history when their official source becomes unavailable", async (context) => {
  const db = await createTestD1(root);
  context.after(() => db.close());
  const sourceKey = "acm-chi-2027";
  await runCallsIngestion(db, { dataset: "calls", sourceKeys: [sourceKey] }, {
    fetchImpl: fixtureFetch(sourceKey), sleep: async () => {}, now: () => "2026-08-28T10:00:00.000Z",
  });
  await runCallsIngestion(db, { dataset: "calls", sourceKeys: [sourceKey] }, {
    fetchImpl: async () => new Response("Unavailable", { status: 503 }),
    sleep: async () => {}, now: () => "2026-08-29T10:00:00.000Z",
  });

  const calls = await readCallsData(db, "2026-08-29T10:00:00.000Z");
  assert.equal(calls.status.status, "partial");
  assert.equal(calls.sources.find((source) => source.key === sourceKey).status, "unavailable");
  assert.ok(calls.calls.every((call) => call.status === "unverified"));
  assert.ok(calls.calls.every((call) => call.lastCheckedAt === "2026-08-29T10:00:00.000Z"));
  assert.ok(calls.calls.every((call) => call.verifiedAt === "2026-08-28T10:00:00.000Z"));
});

test("keeps agenda counts separate from publication and trend counts", async (context) => {
  // Keep the dashboard query at the fixture's ingestion date as deadlines expire.
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-28T10:00:00.000Z") });
  const db = await createTestD1(root);
  context.after(() => db.close());
  await runCallsIngestion(db, { dataset: "calls", sourceKeys: ["acm-chi-2027"] }, {
    fetchImpl: fixtureFetch("acm-chi-2027"), sleep: async () => {}, now: () => "2026-08-28T10:00:00.000Z",
  });
  const dashboard = await readRadarData(db, { days: 90, scope: "ai" });
  assert.equal(dashboard.storage.state, "ready");
  assert.equal(dashboard.counts.totalFound, 0);
  assert.equal(dashboard.counts.analyzed, 0);
  assert.equal(dashboard.calls.counts.active, 2);
  assert.ok(dashboard.calls.agendaSignals.length > 0);
  assert.deepEqual(dashboard.works, []);
  assert.deepEqual(dashboard.trend, []);
});
