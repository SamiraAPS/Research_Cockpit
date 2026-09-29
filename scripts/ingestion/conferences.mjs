import { CORE_CONFERENCES } from "./config.mjs";
import { fetchWithRetry } from "./http.mjs";

export async function resolveConferences(previous, options = {}) {
  const now = options.now ?? new Date();
  if (previous?.checkedAt && now - new Date(previous.checkedAt) < 30 * 86400000) return previous;
  const sources = new Map((previous?.sources ?? []).map(source => [source.id, source]));
  const checks = [];
  for (const conference of CORE_CONFERENCES) {
    const url = new URL("https://api.openalex.org/sources");
    url.searchParams.set("search", conference.name);
    url.searchParams.set("per_page", "50");
    if (options.apiKey) url.searchParams.set("api_key", options.apiKey);
    try {
      const { response } = await fetchWithRetry(url, { source: "OpenAlex", fetchImpl: options.fetchImpl, timeoutMs: 12000, maxAttempts: 2 });
      const payload = await response.json();
      const normalize = value => String(value).toLowerCase().replace(/[^a-z]+/g, " ").trim();
      const name = normalize(conference.name);
      const accepted = (payload.results ?? []).filter(source => normalize(source.display_name).includes(name));
      for (const source of accepted) {
        const id = source.id.split("/").at(-1);
        if (!/^S\d+$/.test(id)) continue;
        sources.set(id, { id, name: source.display_name, family: conference.area, years: (source.counts_by_year ?? []).map(row => row.year), checkedAt: now.toISOString() });
      }
      checks.push({ family: conference.area, status: accepted.length ? "matched" : "no_match", matches: accepted.length });
    } catch (error) { checks.push({ family: conference.area, status: "unavailable", message: error.message }); }
  }
  return { checkedAt: now.toISOString(), method: "name-matched source families; not a guarantee of proceedings completeness", sources: [...sources.values()].sort((a, b) => Math.max(0, ...b.years) - Math.max(0, ...a.years)).slice(0, 45), checks };
}
