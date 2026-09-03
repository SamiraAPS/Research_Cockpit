export const CALLS_SCHEMA_VERSION = "calls-1.1.0";
export const CALLS_REGISTRY_VERSION = "calls-registry-2.0.0";
export const AGENDA_SIGNALS_SCHEMA_VERSION = "agenda-signals-1.0.0";
export const CALLS_CLOSING_WINDOW_DAYS = 30;

export const OFFICIAL_CALL_SOURCES = Object.freeze([
  {
    key: "acm-chi-2027",
    name: "ACM CHI 2027 Calls",
    venue: "ACM CHI 2027",
    organization: "ACM SIGCHI",
    kind: "conference",
    officialUrl: "https://chi2027.acm.org/",
    allowedHosts: ["chi2027.acm.org"],
    adapter: "chi-2027",
    sourceVersion: "acm-chi-2027.2",
    parserVersion: "chi-2027-parser-2.0.0",
    deadlineTimezone: "AoE"
  },
  {
    key: "acm-cscw-rolling",
    name: "ACM CSCW / PACMHCI Rolling Call",
    venue: "ACM CSCW / PACMHCI",
    organization: "ACM SIGCHI",
    kind: "conference",
    officialUrl: "https://cscw.acm.org/rolling.html",
    allowedHosts: ["cscw.acm.org"],
    adapter: "cscw-rolling",
    sourceVersion: "acm-cscw-rolling.1",
    parserVersion: "cscw-rolling-parser-1.0.0",
    deadlineTimezone: "AoE"
  },
  {
    key: "acm-iui-2027",
    name: "ACM IUI 2027 Calls",
    venue: "ACM IUI 2027",
    organization: "ACM SIGCHI",
    kind: "conference",
    officialUrl: "https://iui.acm.org/2027/",
    allowedHosts: ["iui.acm.org"],
    adapter: "iui-2027",
    sourceVersion: "acm-iui-2027.1",
    parserVersion: "iui-2027-parser-1.0.0",
    deadlineTimezone: "AoE"
  },
  {
    key: "acm-ieee-hri-2027",
    name: "ACM/IEEE HRI 2027 Submissions",
    venue: "ACM/IEEE HRI 2027",
    organization: "ACM/IEEE HRI",
    kind: "conference",
    officialUrl: "https://humanrobotinteraction.org/2027/submissions/",
    allowedHosts: ["humanrobotinteraction.org"],
    adapter: "hri-2027",
    sourceVersion: "acm-ieee-hri-2027.1",
    parserVersion: "hri-2027-parser-1.0.0",
    deadlineTimezone: "AoE"
  },
  {
    key: "acm-dis-2027",
    name: "ACM DIS 2027 Call for Papers",
    venue: "ACM DIS 2027",
    organization: "ACM SIGCHI",
    kind: "conference",
    officialUrl: "https://dis.acm.org/2027/call-for-papers/",
    allowedHosts: ["dis.acm.org"],
    adapter: "dis-2027",
    sourceVersion: "acm-dis-2027.1",
    parserVersion: "dis-2027-parser-1.0.0",
    deadlineTimezone: "AoE"
  },
  {
    key: "hfes-aspire",
    name: "HFES ASPIRE Call for Submissions",
    venue: "HFES ASPIRE International Annual Meeting",
    organization: "Human Factors and Ergonomics Society",
    kind: "conference",
    officialUrl: "https://www.hfes.org/Events/ASPIRE-International-Annual-Meeting/Call-for-Submissions",
    allowedHosts: ["hfes.org", "www.hfes.org"],
    adapter: "hfes-aspire",
    sourceVersion: "hfes-aspire.1",
    parserVersion: "hfes-aspire-parser-1.0.0",
    deadlineTimezone: "America/New_York"
  },
  {
    key: "ahfe-2027",
    name: "AHFE 2027 Submissions",
    venue: "AHFE 2027 International Conference",
    organization: "AHFE International",
    kind: "conference",
    officialUrl: "https://www.ahfe.org/submissions.html",
    allowedHosts: ["ahfe.org", "www.ahfe.org"],
    adapter: "ahfe-2027",
    sourceVersion: "ahfe-2027.2",
    parserVersion: "ahfe-2027-parser-2.0.0",
    deadlineTimezone: "not-specified"
  },
  {
    key: "sage-human-relations",
    name: "Human Relations Calls for Papers",
    venue: "Human Relations",
    organization: "SAGE Publications",
    kind: "journal",
    officialUrl: "https://journals.sagepub.com/page/hum/call-for-papers",
    allowedHosts: ["journals.sagepub.com"],
    adapter: "sage-human-relations",
    sourceVersion: "sage-human-relations.2",
    parserVersion: "sage-human-relations-parser-2.0.0",
    deadlineTimezone: "not-specified"
  },
  {
    key: "elsevier-safety-science",
    name: "Safety Science Calls for Papers",
    venue: "Safety Science",
    organization: "Elsevier",
    kind: "journal",
    officialUrl: "https://www.sciencedirect.com/journal/safety-science/about/call-for-papers",
    allowedHosts: ["sciencedirect.com", "www.sciencedirect.com"],
    adapter: "elsevier-journal",
    sourceVersion: "elsevier-safety-science.2",
    parserVersion: "elsevier-journal-parser-2.0.0",
    deadlineTimezone: "not-specified"
  },
  {
    key: "elsevier-applied-ergonomics",
    name: "Applied Ergonomics Calls for Papers",
    venue: "Applied Ergonomics",
    organization: "Elsevier",
    kind: "journal",
    officialUrl: "https://www.sciencedirect.com/journal/applied-ergonomics/about/call-for-papers",
    allowedHosts: ["sciencedirect.com", "www.sciencedirect.com"],
    adapter: "elsevier-journal",
    sourceVersion: "elsevier-applied-ergonomics.1",
    parserVersion: "elsevier-journal-parser-2.0.0",
    deadlineTimezone: "not-specified"
  }
]);

export function findOfficialCallSource(key) {
  return OFFICIAL_CALL_SOURCES.find((source) => source.key === key) ?? null;
}

export function selectOfficialCallSources(keys = []) {
  const requested = keys.length ? [...new Set(keys)] : OFFICIAL_CALL_SOURCES.map((source) => source.key);
  const sources = requested.map(findOfficialCallSource);
  const unknown = requested.filter((_, index) => !sources[index]);
  if (unknown.length) throw new Error(`Unbekannte Calls-Quelle außerhalb der kontrollierten Registry: ${unknown.join(", ")}`);
  return sources;
}
