import assert from "node:assert/strict";
import test from "node:test";
import { callTimeStatus, deadlineLabel, matchesNovelty, weekWindow, auditCsv } from "../../site/assets/js/research.js";
import { searchAndFilterWorks, worksToCsv } from "../../site/assets/js/search.js";
import { deduplicateRecords } from "../../scripts/ingestion/deduplicate.mjs";
import { ingestOpenAlex } from "../../scripts/ingestion/openalex.mjs";

test("AoE labels preserve the source date and expire at the exact instant", () => {
  const call = { deadlineAt: "2026-09-10T23:59:59-12:00", deadlineTimezone: "AoE", status: "open" };
  assert.equal(deadlineLabel(call), "2026-09-10 · 23:59 AoE");
  assert.equal(callTimeStatus(call, "2026-09-11T11:59:58Z"), "closing-soon");
  assert.equal(callTimeStatus(call, "2026-09-11T12:00:00Z"), "expired");
  assert.equal(callTimeStatus({ ...call, status: "unverified" }, "2026-09-01"), "unverified");
});

test("first discovery, publication recency and run-week are distinct filters", () => {
  const work = { id: "old-paper", title: "Trust", publicationDate: "2020-01-01", firstSeenAt: "2026-09-08T12:00:00Z", firstSeenRunId: "run-2" };
  const context = { previousVisit: "2026-09-07T12:00:00Z", latestRunId: "run-2", latestRunAt: "2026-09-11T12:00:00Z", now: Date.parse("2026-09-11") };
  assert.equal(matchesNovelty(work, "since-visit", context), true);
  assert.equal(matchesNovelty(work, "latest-run", context), true);
  assert.equal(matchesNovelty(work, "published-30", context), false);
  assert.equal(matchesNovelty(work, "week", context), true);
  assert.equal(weekWindow(context.latestRunAt).start, Date.parse("2026-09-07"));
  assert.equal(searchAndFilterWorks([work], [], { novelty: "published-30", noveltyContext: context }).length, 0);
  assert.equal(searchAndFilterWorks([work], [], { novelty: "latest-run", noveltyContext: context }).length, 1);
  assert.equal(matchesNovelty(work, "since-visit", { previousVisit: null }), false);
});

test("audit exports keep review fields empty and neutralize spreadsheet formulas", () => {
  const work = { id: "id", title: '=HYPERLINK("bad")', authors: [], classifiedThemes: [] };
  assert.match(worksToCsv([work]), /'=HYPERLINK/);
  const csv = auditCsv([work]);
  assert.match(csv, /manual_label/);
  assert.match(csv, /study_design/);
  assert.doesNotMatch(csv, /manually_verified/);
});

test("bounded OpenAlex pagination exposes a resumable cursor instead of claiming completion", async () => {
  const requests = [];
  const output = await ingestOpenAlex("core", { maxPages: 1, cursor: "resume-here", fetchImpl: async url => {
    requests.push(new URL(url).searchParams.get("cursor"));
    return Response.json({ meta: { count: 2, next_cursor: "next-page" }, results: [{ id: "https://openalex.org/W1", display_name: "Trust in AI", publication_date: "2020-01-01", type: "article" }] });
  } });
  assert.deepEqual(requests, ["resume-here"]);
  assert.equal(output.stats.status, "degraded");
  assert.equal(output.stats.parameters.nextCursor, "next-page");
  assert.equal(output.records.length, 1);
});

test("refreshing a work preserves its first discovery", () => {
  const base = { provider: "openalex", mode: "core", queryVersion: "search-1.0.0", sourceRecordId: "W1", externalIds: { openalex: "W1" }, doi: null,
    title: "Trust in AI", normalizedTitle: "trust in ai", abstract: null, authors: [], venue: null, sourceType: "journal", publicationDate: "2020-01-01", topics: [], keywords: [], evidenceTerms: [], retrievedAt: "2026-09-01T00:00:00Z" };
  const first = deduplicateRecords([base], { generatedAt: base.retrievedAt, runId: "run-1" }).works[0];
  const updated = deduplicateRecords([{ ...base, retrievedAt: "2026-09-11T00:00:00Z" }, { ...base, existingWork: first }], { generatedAt: "2026-09-11T00:00:00Z", runId: "run-2" }).works[0];
  assert.equal(updated.firstSeenAt, first.firstSeenAt);
  assert.equal(updated.firstSeenRunId, "run-1");
});
