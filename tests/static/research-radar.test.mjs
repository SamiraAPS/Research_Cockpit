import assert from "node:assert/strict";
import test from "node:test";
import { classifyWork } from "../../scripts/analysis/classification.mjs";
import { extractEvidence, validateExtraction } from "../../scripts/analysis/evidence.mjs";
import { planDiscoveryRuns, advanceRetrievalState } from "../../scripts/ingestion/schedule.mjs";
import { STATIC_SEARCH_CONFIG_VERSION } from "../../scripts/ingestion/config.mjs";
import { buildOpenAlexUrl } from "../../scripts/ingestion/openalex.mjs";
import { buildResearchRadar, coverageFor, groupCalls, discoverClusters } from "../../scripts/analysis/radar.mjs";
import { catalogDocument, catalogWork } from "../../site/assets/js/catalog.js";
import { validateWorkspace } from "../../site/assets/js/workspace.js";
import { acceptedSemanticEntry, extractWithLocalModel } from "../../scripts/analysis/semantic.mjs";
import { stratifiedSample } from "../../scripts/prepare-review.mjs";
import { manualCandidates } from "../../scripts/calls/manual.mjs";
import { validateResearchData } from "../../scripts/analysis/validate-radar.mjs";

const at = "2026-09-28T12:00:00.000Z";
const makeWork = (id, title, abstract, extra = {}) => classifyWork({ id, title, abstract, recordType: "publication", publicationDate: "2026-07-15", venue: "Applied Ergonomics", authors: [{ name: `Author ${id}` }], topics: [], keywords: [], evidenceTerms: [], scores: {}, classifiedThemes: [], versions: [], discoveredBy: [], ...extra });

test("a general ergonomics query does not require AI; personal lens does not limit retrieval", () => {
  const hf = buildOpenAlexUrl("core", { researchArea: "human-factors", now: new Date(at) }).url.searchParams.get("filter");
  assert.doesNotMatch(hf, /title_and_abstract.search/);
  const ai = buildOpenAlexUrl("broad", { researchArea: "human-ai", now: new Date(at) }).url.searchParams.get("filter");
  assert.match(ai, /artificial intelligence/);
  assert.match(ai, /participant/);
});
test("fresh retrieval cannot inherit an old historical cursor; budgets are independent", () => {
  const meta = { ingestionProgress: { "openalex:core": { range: { from: "2018-01-01", to: "2018-12-31" }, cursor: "old-cursor" } } };
  const jobs = planDiscoveryRuns(meta, { now: new Date(at), maxPages: 5, backgroundPages: 2 }, ["core", "broad", "frontier"]);
  const fresh = jobs.filter(job => job.lane === "fresh");
  assert.equal(fresh.length, 8);
  assert.ok(fresh.every(job => job.range.to === "2026-09-28" && job.range.from === "2026-09-14" && !job.cursor && job.maxPages === 5));
  assert.ok(jobs.filter(job => job.lane !== "fresh").every(job => job.maxPages === 2));
  const next = advanceRetrievalState(null, [{ provider: "openalex", modes: ["core"], status: "degraded", foundCount: 900, recordCount: 200, parameters: { streamKey: "openalex:core:human-ai:backfill", lane: "backfill", researchArea: "human-ai", fromDate: "2018-01-01", toDate: "2018-01-30", nextCursor: "cursor-2" } }], at);
  assert.equal(next.streams["openalex:core:human-ai:backfill"].cursor, "cursor-2");
  assert.equal(next.streams["openalex:core:human-ai:backfill"].complete, false);
});
test("reflection is human learning evidence; machine-only learning and attention do not become human themes", () => {
  const reflection = makeWork("reflection", "Comparing GenAI Summaries Versus Chatbots for Supporting Reflection in Healthcare Simulation", "Forty-one nursing students reflected on simulated clinical cases.");
  assert.ok(reflection.classifiedThemes.some(t => t.theme === "learning"));
  assert.equal(reflection.research.learner, "human-mentioned");
  for (const title of ["Comparative evaluation of classical machine learning and deep learning models for early weed detection in precision agriculture", "Attention mechanisms for autonomous AI agents"]) {
    const work = makeWork("technical", title, "We train a neural network for image classification.", { venue: "Technical Journal", keywords: ["learning", "attention"] });
    assert.equal(work.research.relevance.status, "excluded");
    assert.deepEqual(work.classifiedThemes, []);
  }
  const ergonomics = makeWork("hf", "Manual lifting and job design", "Workers evaluated physical workload.");
  assert.ok(ergonomics.research.relevance.areas.includes("human-factors"));
  assert.ok(!ergonomics.research.relevance.areas.includes("human-ai"));
  assert.equal(extractEvidence({ title: "A new method", abstract: null }).relevance.status, "uncertain");
});
test("all rule quotes point to exact spans and fabricated model quotes are rejected", async () => {
  const work = makeWork("spans", "AI feedback and reflection", "Students reported intrinsic motivation during clinical simulation.");
  const sample = work.research.personalFit[0].evidence[0];
  assert.equal(work[sample.field].slice(sample.start, sample.end), sample.quote);
  assert.throws(() => validateExtraction(work, { workId: work.id, claims: [{ field: "finding", value: "improved", source: "abstract", quote: "A fabricated large improvement" }] }));
  const entry = await extractWithLocalModel(work, { model: "test-model", fetchImpl: async () => Response.json({ model: "test-model", message: { content: JSON.stringify({ workId: work.id, claims: [{ field: "population", value: "students", source: "abstract", quote: work.abstract }] }) } }) });
  assert.ok(acceptedSemanticEntry(work, entry));
  assert.equal(acceptedSemanticEntry({ ...work, abstract: "Changed abstract" }, entry), null);
});
test("preprints enter both current trends and clusters; missing coverage blocks a direction claim", () => {
  const works = Array.from({ length: 6 }, (_, i) => makeWork(`w${i}`, "Reflective prompts for railway dispatchers", "Human AI feedback supports reflection, cognitive engagement and situation awareness in railway operations.", { recordType: i % 2 ? "preprint" : "publication", publicationDate: i < 3 ? "2026-07-15" : "2026-04-15" }));
  const radar = buildResearchRadar(works, { items: [] }, { queryVersion: STATIC_SEARCH_CONFIG_VERSION }, at);
  assert.ok(radar.series.find(s => s.area === "human-ai").monthly.some(row => row.preprints > 0));
  assert.equal(radar.series[0].comparison.comparable, false);
  assert.ok(radar.clusters.some(cluster => cluster.preprintCount > 0));
  assert.ok(radar.ideas.every(idea => idea.noveltyVerified === false));
  assert.equal(radar.validation.precision, null);
  const repeatedAuthors = discoverClusters(works.map(work => ({ ...work, authors: [{ name: "One team" }] })), at, []);
  assert.equal(repeatedAuthors[0].authorGroups, 1);
});
test("coverage must join complete windows for every provider, mode and research area", () => {
  const history = ["openalex:core", "openalex:broad", "openalex:frontier", "arxiv:frontier"].map(stream => { const [provider, mode] = stream.split(":"); return { provider, mode, researchArea: "human-ai", complete: true, range: { from: "2026-01-01", to: "2026-06-30" } }; });
  const meta = { retrievalState: { queryVersion: STATIC_SEARCH_CONFIG_VERSION, streams: {}, history } };
  assert.equal(coverageFor(meta, "human-ai", "2026-01-01", "2026-06-30").complete, true);
  assert.equal(coverageFor(meta, "human-factors", "2026-01-01", "2026-06-30").complete, false);
  meta.retrievalState.history.pop();
  assert.equal(coverageFor(meta, "human-ai", "2026-01-01", "2026-06-30").complete, false);
});
test("nine general tracks from one event are one event and no thematic trend", () => {
  const calls = { items: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, title: `HRI 2027 track ${i}`, venue: "HRI", sourceKey: "hri", callType: "papers", description: "Trust and teaming with AI", status: "open", deadlineAt: "2026-10-20T23:59:59Z", lastVerifiedAt: at })) };
  const grouped = groupCalls(calls, at);
  assert.equal(grouped.length, 1); assert.equal(grouped[0].signalKind, "general-event"); assert.equal(grouped[0].themes.length, 0);
  calls.items.push({ ...calls.items[0], id: "thematic", sourceKey: "journal", title: "Intrinsic motivation with AI", callType: "special_issue", venue: "Journal" });
  assert.equal(groupCalls(calls, at).filter(group => group.signalKind === "thematic-agenda").length, 1);
  assert.throws(() => manualCandidates({ schemaVersion: "manual-calls-1.0.0", items: [{ sourceKey: "fake" }] }, at));
});
test("compact catalog keeps filters and personal fit while omitting full abstracts", () => {
  const original = makeWork("catalog", "Human AI reflection", "Workers reflect on task outcomes.");
  const document = catalogDocument(original), restored = catalogWork(document);
  assert.equal(document.abstract, null);
  assert.equal(restored.title, original.title);
  assert.deepEqual(restored.research.relevance.areas, original.research.relevance.areas);
  assert.equal(restored.research.personalFit.length, original.research.personalFit.length);
});
test("review sample is deterministic and held-out partition does not depend on manual labels", () => {
  const works = Array.from({ length: 300 }, (_, i) => makeWork(`w${i}`, `Human AI work reflection ${i}`, i % 3 ? "Students report task performance." : null));
  const selected = stratifiedSample(works), shuffled = stratifiedSample([...works].reverse());
  assert.equal(selected.length, 250); assert.deepEqual(selected.map(row => row.work.id), shuffled.map(row => row.work.id));
  assert.ok(selected.some(row => row.split === "held-out"));
});
test("workspace import validates types, prevents prototype keys and preserves notes", () => {
  const data = { version: 1, notes: { "doi:abc": "My note" }, ideas: [{ id: "idea:learning", question: "Transfer?", stage: "reading", evidenceWorkIds: ["doi:abc"] }] };
  assert.equal(validateWorkspace(data).notes["doi:abc"], "My note");
  assert.throws(() => validateWorkspace(JSON.parse('{"version":1,"notes":{"__proto__":"bad"},"ideas":[]}')));
  assert.throws(() => validateWorkspace({ ...data, ideas: [{ id: "x", question: "x", stage: "invented" }] }));
});
test("data validation rejects altered research evidence", () => {
  const work = makeWork("badquote", "Human AI reflection", "Students reported reflection.");
  work.research.personalFit[0].evidence[0].quote = "Not present";
  assert.ok(validateResearchData(new Map([["works/page-001.json", { items: [work] }]])).some(error => /Textbeleg/.test(error.message)));
});
