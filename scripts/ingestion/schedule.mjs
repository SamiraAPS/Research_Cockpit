import { STATIC_SEARCH_CONFIG_VERSION, RESEARCH_AREAS } from "./config.mjs";
import { dateRange } from "./openalex.mjs";

const day = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const nextDay = value => iso(Date.parse(value) + day);

export function planDiscoveryRuns(meta, options, modes) {
  const now = options.now ?? new Date();
  const today = iso(now);
  const streams = modes.flatMap(mode => RESEARCH_AREAS.flatMap(researchArea =>
    (mode === "frontier" ? ["openalex", "arxiv"] : ["openalex"]).map(provider => ({ provider, mode, researchArea }))));
  const jobs = [];
  const state = meta.retrievalState?.queryVersion === STATIC_SEARCH_CONFIG_VERSION ? meta.retrievalState.streams ?? {} : {};
  const rotation = Math.floor(now.getTime() / day) % streams.length;
  for (const [index, stream] of streams.entries()) {
    const streamKey = `${stream.provider}:${stream.mode}:${stream.researchArea}`;
    const add = (lane, extra) => jobs.push({ ...stream, lane, key: `${streamKey}:${lane}`, ...extra });
    // Always start with the newest window, irrespective of older incomplete cursors.
    add("fresh", { range: dateRange(options.freshDays ?? 14, now), maxPages: options.maxPages ?? 5 });
    // Background work has its own cursor, date range and budget.
    if (![rotation, (rotation + 1) % streams.length].includes(index)) continue;
    const prior = state[`${streamKey}:backfill`];
    const from = prior && !prior.complete ? prior.range.from : prior ? nextDay(prior.range.to) : stream.mode === "core" ? "2018-01-01" : "2024-01-01";
    const end = iso(Date.parse(from) + 29 * day);
    if (from <= today) add("backfill", { range: prior && !prior.complete ? prior.range : { from, to: end < today ? end : today }, cursor: prior && !prior.complete ? prior.cursor : null, start: prior && !prior.complete ? prior.start : 0, maxPages: options.backgroundPages ?? 2 });
    // Late indexing: cycle across six months, separately from historical work.
    const late = state[`${streamKey}:recheck`];
    let lateFrom = late && !late.complete ? late.range.from : late ? nextDay(late.range.to) : iso(now.getTime() - 180 * day);
    if (lateFrom > iso(now.getTime() - 14 * day)) lateFrom = iso(now.getTime() - 180 * day);
    add("recheck", { range: late && !late.complete ? late.range : { from: lateFrom, to: iso(Math.min(Date.parse(lateFrom) + 6 * day, now.getTime())) }, cursor: late && !late.complete ? late.cursor : null, start: late && !late.complete ? late.start : 0, maxPages: options.backgroundPages ?? 2 });
  }
  return jobs;
}

export function advanceRetrievalState(previous, jobs, generatedAt) {
  const state = previous?.queryVersion === STATIC_SEARCH_CONFIG_VERSION ? structuredClone(previous) : { queryVersion: STATIC_SEARCH_CONFIG_VERSION, streams: {}, history: [] };
  for (const stats of jobs) {
    const { streamKey: key, lane, researchArea, fromDate: from, toDate: to } = stats.parameters;
    if (!key) continue;
    const prior = state.streams[key];
    const continuing = lane !== "fresh" && prior && !prior.complete && prior.range.from === from && prior.range.to === to;
    const completed = stats.status === "healthy";
    const record = { provider: stats.provider, mode: stats.modes[0], researchArea, lane, range: { from, to }, cursor: completed ? null : stats.parameters.nextCursor ?? (continuing ? prior.cursor : null), start: completed ? null : stats.parameters.nextStart ?? (continuing ? prior.start : null), retrieved: (continuing ? prior.retrieved : 0) + stats.recordCount, found: stats.foundCount, complete: completed, checkedAt: generatedAt, lastSuccessfulAt: completed ? generatedAt : prior?.lastSuccessfulAt ?? null };
    state.streams[key] = record;
    state.history.push({ ...record, key, cursor: null, start: null });
  }
  state.history = state.history.slice(-2000);
  return state;
}
