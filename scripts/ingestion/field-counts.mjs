import { buildOpenAlexUrl } from "./openalex.mjs";
import { fetchWithRetry } from "./http.mjs";
import { STATIC_SEARCH_CONFIG_VERSION, RESEARCH_AREAS } from "./config.mjs";

export async function fetchFieldCounts(previous, options = {}) {
  const now = options.now ?? new Date();
  if (previous?.queryVersion === STATIC_SEARCH_CONFIG_VERSION && previous.status === "ready" && now - new Date(previous.generatedAt) < 7 * 86400000) return previous;
  const series = [];
  for (const area of RESEARCH_AREAS) {
    try {
      const counts = [];
      let publicUrl;
      for (const preprintsOnly of [false, true]) {
        const { url } = buildOpenAlexUrl("broad", { researchArea: area, range: { from: "2018-01-01", to: now.toISOString().slice(0, 10) } });
        url.searchParams.set("filter", url.searchParams.get("filter").replace(/type:[^,]+/, preprintsOnly ? "type:preprint" : "type:article|review|book-chapter|proceedings-article|preprint"));
        for (const key of ["select", "sort", "cursor"]) url.searchParams.delete(key);
        url.searchParams.set("group_by", "publication_year"); url.searchParams.set("per_page", "200");
        if (!preprintsOnly) publicUrl = url.toString();
        if (options.apiKey) url.searchParams.set("api_key", options.apiKey);
        const { response } = await fetchWithRetry(url, { source: "OpenAlex", fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? 12000, maxAttempts: 2 });
        const data = await response.json();
        if (!Array.isArray(data.group_by) || data.group_by.some(row => !Number.isInteger(Number(row.key)) || !Number.isInteger(row.count) || row.count < 0) || data.group_by.reduce((sum, row) => sum + row.count, 0) !== data.meta?.count) throw new Error("Incomplete or invalid annual count aggregation");
        counts.push(new Map(data.group_by.map(row => [Number(row.key), row.count])));
      }
      const annual = [];
      for (let year = 2018; year <= now.getUTCFullYear(); year++) {
        const count = counts[0].get(year) ?? 0, preprints = counts[1].get(year) ?? 0;
        if (preprints > count) throw new Error("Preprint count exceeds total");
        annual.push({ period: String(year), count, preprints, partialPeriod: year === now.getUTCFullYear(), coverage: { complete: true, reason: "Aggregate query counted; relevance and database coverage not validated" } });
      }
      series.push({ area, status: "ready", generatedAt: now.toISOString(), queryUrl: publicUrl, annual });
    } catch (error) {
      const old = previous?.queryVersion === STATIC_SEARCH_CONFIG_VERSION ? previous.series?.find(row => row.area === area) : null;
      series.push({ ...(old ?? { area, annual: [] }), status: old ? "stale" : "unavailable", message: error.message, checkedAt: now.toISOString() });
    }
  }
  return { queryVersion: STATIC_SEARCH_CONFIG_VERSION, generatedAt: now.toISOString(), status: series.every(row => row.status === "ready") ? "ready" : "partial", interpretation: "Counts of OpenAlex query matches including preprints, not validated worldwide psychology-and-AI totals. Separate from the downloaded corpus; independent of page budgets.", series };
}
