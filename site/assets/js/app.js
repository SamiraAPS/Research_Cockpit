import { renderComponentBar, renderHorizontalBars } from "./charts.js";
import { normalizeSearchText, paginate, searchAndFilterWorks, sortWorkResults, worksToBibtex, worksToCsv } from "./search.js";

const DATA_URLS = {
  meta: "./data/meta.json",
  works: "./data/works/page-001.json",
  search: "./data/search-index.json",
  calls: "./data/calls.json",
  trends: "./data/trends.json",
  questions: "./data/questions.json",
  health: "./data/source-health.json"
};
const VIEW_IDS = ["overview", "new", "landscape", "emerging", "calls", "opportunities", "method"];
const VIEW_TITLES = { overview: "Overview", new: "New & Search", landscape: "Landscape", emerging: "Emerging Signals", calls: "Calls", opportunities: "Opportunities", method: "Method" };
const STORAGE_KEYS = { shortlist: "human-ai-research-radar.shortlist.v1", lastRun: "human-ai-research-radar.last-run.v1" };
const PAGE_SIZE = 8;
const DATE_FORMAT = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "short", year: "numeric" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const LABELS = {
  ready: "verfügbar", partial: "teilweise", unavailable: "nicht verfügbar", empty: "ausstehend", error: "Fehler",
  journal: "Journal", proceedings: "Proceedings", preprint: "Preprint", publication: "Publikation",
  current: "aktuell", stale: "veraltet", open: "offen", "closing-soon": "schließt bald", expired: "abgelaufen", unverified: "ungeprüft",
  growing: "wachsend", stable: "stabil", declining: "rückläufig", mixed: "gemischt", insufficient: "nicht ausreichend",
  emerging: "emerging", rising: "zunehmend", cooling: "abkühlend", strong: "stark", moderate: "moderat", weak: "schwach",
  possible: "möglich", low: "niedrig", high: "hoch", medium: "mittel", framework: "Lens-Frage", supported: "belegt"
};
const COMPONENT_LABELS = { publication_momentum: "Publikationsdynamik", frontier_share: "Preprint-Anteil", agenda_demand: "Agenda-Nachfrage", source_diversity: "Quellenvielfalt" };

const state = {
  data: { meta: null, works: [], documents: [], calls: null, trends: null, questions: null, health: null },
  loadErrors: new Map(),
  shortlist: loadStoredSet(STORAGE_KEYS.shortlist),
  newWorkIds: new Set(),
  workPage: 1,
  workFilters: { query: "", year: "all", source: "all", type: "all", theme: "all", mode: "all", dataStatus: "all", sort: "newest", shortlistOnly: false },
  callFilters: { deadline: "upcoming", query: "", sort: "deadline" }
};

const elements = Object.fromEntries([
  "primary-nav-list", "nav-toggle", "dashboard-views", "loading-state", "data-integrity-bar", "data-status-badge", "data-status-message",
  "error-state", "error-message", "retry-button", "status-announcer", "shortlist-count", "shortlist-jump", "freshness-value", "corpus-value",
  "source-summary", "overview-new-list", "overview-deadline-list", "overview-emerging-list", "work-filters", "work-query", "filter-year",
  "filter-source", "filter-type", "filter-theme", "filter-mode", "filter-data-status", "work-sort", "shortlist-only", "reset-filters",
  "export-bibtex", "export-csv", "work-result-count", "search-scope-note", "work-results", "work-pagination", "new-since-copy",
  "landscape-chart", "composition-summary", "question-list", "emerging-notice", "emerging-grid", "call-filters", "deadline-filter", "call-query",
  "call-sort", "calls-table-body", "calls-caption", "calls-empty", "opportunity-notice", "opportunity-grid", "method-cards", "version-list",
  "warning-list", "source-table-body", "footer-version", "footer-updated"
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));
elements.nav = document.querySelector(".primary-nav");
elements.navLinks = [...document.querySelectorAll(".nav-link")];

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(value, withTime = false) {
  if (!value) return "Nicht angegeben";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Ungültiges Datum" : (withTime ? DATE_TIME_FORMAT : DATE_FORMAT).format(date);
}

function label(value) {
  return LABELS[value] ?? String(value ?? "–").replaceAll("_", " ");
}

function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

function loadStoredSet(key) {
  try {
    const parsed = JSON.parse(safeStorageGet(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []);
  } catch { return new Set(); }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function loadWorks() {
  const works = [];
  let url = DATA_URLS.works;
  const visited = new Set();
  while (url) {
    if (visited.has(url)) throw new Error("Zirkuläre Works-Pagination erkannt.");
    visited.add(url);
    const page = await fetchJson(url);
    works.push(...(page.items ?? []));
    url = page.nextPage ? `./data/works/${page.nextPage.replace(/^\.\//, "")}` : null;
  }
  return works;
}

function viewFromHash() {
  const requested = window.location.hash.slice(1).toLocaleLowerCase("en");
  return VIEW_IDS.includes(requested) ? requested : "overview";
}

function closeNavigation() {
  elements.primary_nav_list.classList.remove("is-open");
  elements.nav_toggle.setAttribute("aria-expanded", "false");
}

function showView(viewId, { moveFocus = false } = {}) {
  const active = VIEW_IDS.includes(viewId) ? viewId : "overview";
  for (const view of document.querySelectorAll("[data-view]")) view.hidden = view.dataset.view !== active;
  for (const link of elements.navLinks) {
    if (link.hash === `#${active}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `${VIEW_TITLES[active]} · Human–AI Research Radar`;
  closeNavigation();
  if (moveFocus && !elements.dashboard_views.hidden) document.querySelector(`[data-view="${active}"]`)?.focus({ preventScroll: true });
}

function statusChip(status, extra = "") {
  const chip = node("span", `data-chip status-${status} ${extra}`.trim(), label(status));
  return chip;
}

function renderEmpty(container, title, message) {
  container.replaceChildren();
  const wrapper = node("div", "empty-state");
  wrapper.append(node("span", "empty-mark"), node("h2", null, title), node("p", null, message));
  container.append(wrapper);
}

function announce(message) {
  elements.status_announcer.textContent = "";
  window.requestAnimationFrame(() => { elements.status_announcer.textContent = message; });
}

function updateDatasetStatuses() {
  const meta = state.data.meta;
  for (const item of document.querySelectorAll("[data-dataset]")) {
    const key = item.dataset.dataset;
    const error = state.loadErrors.has(key === "publications" ? "works" : key === "sourceHealth" ? "health" : key);
    const raw = error ? "error" : meta?.datasets?.[key]?.status ?? "empty";
    item.className = raw;
    item.querySelector("strong").textContent = label(raw);
  }
}

function setDashboardState(dashboardState, message) {
  document.body.dataset.dashboardState = dashboardState;
  elements.loading_state.hidden = dashboardState !== "loading";
  elements.error_state.hidden = dashboardState !== "error";
  elements.data_integrity_bar.hidden = !["partial", "ready", "empty"].includes(dashboardState);
  elements.dashboard_views.hidden = !["partial", "ready", "empty"].includes(dashboardState);
  elements.dashboard_views.setAttribute("aria-busy", String(dashboardState === "loading"));
  const badgeText = { loading: "Daten werden geladen", ready: "Daten verfügbar", partial: "Daten teilweise verfügbar", empty: "Daten noch nicht verfügbar", error: "Datenfehler" }[dashboardState];
  elements.data_status_badge.className = `status-badge ${dashboardState}`;
  elements.data_status_badge.lastElementChild.textContent = badgeText;
  if (message) elements.data_status_message.textContent = message;
  if (dashboardState !== "loading") updateDatasetStatuses();
}

function determineNewWorks() {
  const inputHash = state.data.trends?.inputHash ?? state.data.meta?.generatedAt;
  let previous = null;
  try { previous = JSON.parse(safeStorageGet(STORAGE_KEYS.lastRun) ?? "null"); } catch { previous = null; }
  if (previous?.inputHash && previous.inputHash !== inputHash && Array.isArray(previous.workIds)) {
    const known = new Set(previous.workIds);
    state.newWorkIds = new Set(state.data.works.filter((work) => !known.has(work.id)).map((work) => work.id));
    elements.new_since_copy.textContent = `${state.newWorkIds.size} Arbeiten sind seit dem zuvor lokal gesehenen Datenlauf neu hinzugekommen.`;
  } else if (previous?.inputHash === inputHash) {
    state.newWorkIds = new Set();
    elements.new_since_copy.textContent = "Seit dem zuletzt lokal gesehenen Datenstand sind keine neuen IDs hinzugekommen; angezeigt wird der aktuelle Korpus.";
  } else {
    state.newWorkIds = new Set(state.data.works.map((work) => work.id));
    elements.new_since_copy.textContent = "Erster lokaler Vergleich: Die Arbeiten des aktuellen Datenlaufs gelten als neu. Künftige Läufe werden per ID verglichen.";
  }
  safeStorageSet(STORAGE_KEYS.lastRun, JSON.stringify({ inputHash, workIds: state.data.works.map((work) => work.id), seenAt: new Date().toISOString() }));
}

function renderOverview() {
  const { meta, works, calls, trends, health } = state.data;
  elements.freshness_value.textContent = formatDate(meta?.lastSuccessfulIngestionAt, true);
  elements.corpus_value.textContent = `${works.length} Works · ${works.filter((work) => work.recordType === "preprint").length} Preprints`;
  const healthy = health?.sources?.filter((source) => source.status === "healthy").length ?? 0;
  const totalSources = health?.sources?.length ?? 0;
  elements.source_summary.textContent = totalSources ? `${healthy}/${totalSources} gesund` : "nicht geladen";

  const newest = sortWorkResults(works.map((work) => ({ work, document: work, relevance: 0 }))).slice(0, 3);
  if (!newest.length) renderEmpty(elements.overview_new_list, "Daten noch nicht verfügbar", "Es wurden keine Publikationen geladen.");
  else {
    elements.overview_new_list.replaceChildren();
    for (const { work } of newest) {
      const item = node("article", "compact-item");
      const metaLine = node("p", "compact-meta", `${formatDate(work.publicationDate)} · ${work.venue ?? "Venue unbekannt"}`);
      const title = node("h3");
      const link = node("a", null, work.title);
      link.href = "#new";
      title.append(link);
      item.append(metaLine, title);
      elements.overview_new_list.append(item);
    }
  }

  const now = Date.now();
  const deadlines = (calls?.items ?? []).filter((call) => ["open", "closing-soon"].includes(call.status) && call.deadlineAt && Date.parse(call.deadlineAt) >= now)
    .sort((left, right) => Date.parse(left.deadlineAt) - Date.parse(right.deadlineAt)).slice(0, 3);
  if (!deadlines.length) renderEmpty(elements.overview_deadline_list, "Keine kommende Deadline", "Aktuell ist keine verifizierte zukünftige Deadline verfügbar.");
  else {
    elements.overview_deadline_list.replaceChildren();
    for (const call of deadlines) {
      const item = node("article", "compact-item deadline-item");
      const time = node("time", "deadline-date", formatDate(call.deadlineAt));
      time.dateTime = call.deadlineAt;
      const title = node("h3");
      const link = node("a", null, call.title);
      link.href = call.officialUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      title.append(link);
      item.append(time, title, statusChip(call.status));
      elements.overview_deadline_list.append(item);
    }
  }

  const trendByTheme = new Map((trends?.publicationTrends ?? []).map((entry) => [entry.theme, entry]));
  const emerging = [...(trends?.emergingSignals ?? [])].sort((left, right) => {
    const rank = { emerging: 4, rising: 3, stable: 2, cooling: 1, insufficient: 0 };
    return (rank[right.status] - rank[left.status]) || ((trendByTheme.get(right.theme)?.totals.absoluteCount ?? 0) - (trendByTheme.get(left.theme)?.totals.absoluteCount ?? 0));
  }).slice(0, 3);
  if (!emerging.length) renderEmpty(elements.overview_emerging_list, "Noch nicht berechnet", "Keine Emerging-Signale verfügbar.");
  else {
    elements.overview_emerging_list.replaceChildren();
    for (const signal of emerging) {
      const item = node("article", "compact-item signal-item");
      item.append(statusChip(signal.status), node("h3", null, signal.label));
      const count = trendByTheme.get(signal.theme)?.totals.absoluteCount ?? 0;
      item.append(node("p", "compact-meta", `${count} Korpusbelege · Wachstum ${signal.shortGrowthPercent === null ? "nicht berechenbar" : `${signal.shortGrowthPercent}%`}`));
      elements.overview_emerging_list.append(item);
    }
  }
}

function populateSelect(select, values, valueLabel = (value) => value) {
  const current = select.value;
  for (const value of values) {
    const option = node("option", null, valueLabel(value));
    option.value = value;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function populateWorkFilters() {
  for (const select of [elements.filter_year, elements.filter_source, elements.filter_theme]) while (select.options.length > 1) select.remove(1);
  const years = [...new Set(state.data.works.map((work) => String(work.publicationDate ?? "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const sources = [...new Set(state.data.works.flatMap((work) => [work.source?.name, ...(work.discoveredBy ?? []).map((entry) => entry.provider)]).filter(Boolean))].sort();
  const themes = [...new Map(state.data.works.flatMap((work) => (work.classifiedThemes ?? []).map((theme) => [theme.theme, theme.label]))).entries()].sort((a, b) => a[1].localeCompare(b[1], "de"));
  populateSelect(elements.filter_year, years);
  populateSelect(elements.filter_source, sources);
  populateSelect(elements.filter_theme, themes.map(([id]) => id), (id) => themes.find(([theme]) => theme === id)?.[1] ?? id);
}

function publicationCard(result) {
  const { work, kind } = result;
  const article = node("article", "publication-card");
  article.dataset.workId = work.id;
  const heading = node("div", "publication-heading");
  const copy = node("div");
  const meta = node("p", "publication-meta", `${formatDate(work.publicationDate)} · ${work.venue ?? "Venue unbekannt"}`);
  const title = node("h2", null, work.title);
  const authors = node("p", "publication-authors", (work.authors ?? []).map((author) => author.name).join(", ") || "Autor:innen nicht verfügbar");
  copy.append(meta, title, authors);
  const shortlistButton = node("button", "shortlist-button", state.shortlist.has(work.id) ? "Gemerkt" : "Merken");
  shortlistButton.type = "button";
  shortlistButton.dataset.shortlistId = work.id;
  shortlistButton.setAttribute("aria-pressed", String(state.shortlist.has(work.id)));
  shortlistButton.setAttribute("aria-label", `${work.title} ${state.shortlist.has(work.id) ? "von der Shortlist entfernen" : "zur Shortlist hinzufügen"}`);
  heading.append(copy, shortlistButton);
  const chips = node("div", "chip-row");
  chips.append(statusChip(kind), statusChip(work.dataStatus ?? "current"));
  for (const discovery of work.discoveredBy ?? []) chips.append(node("span", "data-chip", discovery.mode));
  for (const theme of work.classifiedThemes ?? []) chips.append(node("span", "data-chip theme-chip", theme.label));
  article.append(heading, chips);

  const details = node("details", "publication-details");
  details.append(node("summary", null, "Abstract, DOI und Themen-Evidenz"));
  const body = node("div", "details-body");
  if (work.doi) {
    const doiLine = node("p");
    doiLine.append(node("strong", null, "DOI: "));
    const doiLink = node("a", "text-link", work.doi);
    doiLink.href = `https://doi.org/${work.doi}`;
    doiLink.target = "_blank";
    doiLink.rel = "noopener noreferrer";
    doiLine.append(doiLink);
    body.append(doiLine);
  } else body.append(node("p", "muted-copy", "DOI nicht verfügbar."));
  body.append(node("h3", null, "Abstract"), node("p", "abstract-copy", work.abstract ?? "Abstract nicht verfügbar."));
  body.append(node("h3", null, "Themen-Evidenz"));
  if (!(work.classifiedThemes ?? []).length) body.append(node("p", "muted-copy", "Keine Klassifikation oberhalb der methodischen Schwelle."));
  for (const theme of work.classifiedThemes ?? []) {
    const evidence = node("section", "evidence-block");
    evidence.append(node("h4", null, `${theme.label} · Score ${theme.score}`));
    const list = node("ul");
    for (const item of theme.evidence ?? []) list.append(node("li", null, `„${item.matchedTerm}“ · ${label(item.source)} · Gewicht ${item.weight}`));
    evidence.append(list);
    body.append(evidence);
  }
  details.append(body);
  article.append(details);
  return article;
}

function currentWorkResults() {
  const results = searchAndFilterWorks(state.data.works, state.data.documents, { ...state.workFilters, shortlistIds: state.shortlist });
  return sortWorkResults(results, state.workFilters.sort);
}

function renderWorkResults({ announceChange = false } = {}) {
  const results = currentWorkResults();
  const page = paginate(results, state.workPage, PAGE_SIZE);
  state.workPage = page.currentPage;
  elements.work_results.replaceChildren();
  elements.work_result_count.textContent = `${page.totalItems} ${page.totalItems === 1 ? "Ergebnis" : "Ergebnisse"}`;
  elements.search_scope_note.textContent = state.workFilters.query ? "Alle Suchbegriffe müssen im statischen Index vorkommen." : "Suche über den gesamten statischen Index.";
  if (!page.items.length) renderEmpty(elements.work_results, "Keine passenden Arbeiten", "Passe Suche oder Filter an. Es werden keine Ersatztreffer erzeugt.");
  else for (const result of page.items) elements.work_results.append(publicationCard(result));
  renderPagination(page);
  elements.export_bibtex.disabled = !results.length;
  elements.export_csv.disabled = !results.length;
  if (announceChange) announce(`${page.totalItems} Publikationsergebnisse, Seite ${page.currentPage} von ${page.totalPages}.`);
}

function renderPagination(page) {
  elements.work_pagination.replaceChildren();
  if (page.totalPages <= 1) return;
  const previous = node("button", "pagination-button", "Zurück");
  previous.type = "button";
  previous.disabled = page.currentPage === 1;
  previous.dataset.page = String(page.currentPage - 1);
  elements.work_pagination.append(previous);
  for (let index = 1; index <= page.totalPages; index += 1) {
    const button = node("button", "pagination-button", String(index));
    button.type = "button";
    button.dataset.page = String(index);
    button.setAttribute("aria-label", `Seite ${index}`);
    if (index === page.currentPage) button.setAttribute("aria-current", "page");
    elements.work_pagination.append(button);
  }
  const next = node("button", "pagination-button", "Weiter");
  next.type = "button";
  next.disabled = page.currentPage === page.totalPages;
  next.dataset.page = String(page.currentPage + 1);
  elements.work_pagination.append(next);
}

function updateShortlist(workId) {
  if (state.shortlist.has(workId)) state.shortlist.delete(workId);
  else state.shortlist.add(workId);
  safeStorageSet(STORAGE_KEYS.shortlist, JSON.stringify([...state.shortlist]));
  elements.shortlist_count.textContent = String(state.shortlist.size);
  renderWorkResults();
  announce(`Shortlist enthält ${state.shortlist.size} Arbeiten.`);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = node("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderLandscape() {
  const trends = state.data.trends;
  if (!trends) {
    renderEmpty(elements.landscape_chart, "Analyse nicht verfügbar", "trends.json konnte nicht geladen werden.");
    return;
  }
  renderHorizontalBars(elements.landscape_chart, trends.publicationTrends.map((trend) => ({ label: trend.label, value: trend.totals.absoluteCount })), {
    caption: "Absolute Themenhäufigkeit im aktuellen Korpus",
    formatValue: (value) => `${value} ${value === 1 ? "Arbeit" : "Arbeiten"}`
  });
  elements.composition_summary.replaceChildren();
  const composition = [
    ["Journal", trends.coverage.journalCount], ["Proceedings", trends.coverage.proceedingsCount], ["Preprints", trends.coverage.preprints], ["Venues", new Set(state.data.works.map((work) => work.venue).filter(Boolean)).size]
  ];
  for (const [name, value] of composition) {
    const item = node("div", "composition-card");
    item.append(node("strong", null, String(value)), node("span", null, name));
    elements.composition_summary.append(item);
  }
  elements.composition_summary.append(node("p", "muted-copy span-all", "Themen können mehrfach vergeben werden. Quellen- und Venue-Vielfalt werden getrennt ausgewiesen."));

  elements.question_list.replaceChildren();
  const questions = [...(state.data.questions?.dataDerived ?? []), ...(state.data.questions?.lens ?? [])];
  if (!questions.length) renderEmpty(elements.question_list, "Keine Fragen verfügbar", "questions.json enthält keine Einträge.");
  for (const question of questions) {
    const card = node("article", "question-card");
    card.append(statusChip(question.status), node("h3", null, question.question));
    card.append(node("p", "muted-copy", question.rationale ?? `${question.count ?? 0} Evidenzarbeiten; Mindestfallzahl ${question.minimumEvidenceRecords ?? state.data.questions.minimumEvidenceRecords}.`));
    if (question.evidence?.length) {
      const list = node("ul", "evidence-links");
      for (const evidence of question.evidence) {
        const work = state.data.works.find((entry) => entry.id === evidence.workId);
        list.append(node("li", null, work ? work.title : evidence.workId));
      }
      card.append(list);
    }
    elements.question_list.append(card);
  }
}

function renderEmerging() {
  const trends = state.data.trends;
  if (!trends) {
    renderEmpty(elements.emerging_grid, "Emerging Signals nicht verfügbar", "Die Analysedatei konnte nicht geladen werden.");
    return;
  }
  elements.emerging_notice.replaceChildren(statusChip(trends.status), node("p", null, `Vergleich bis ${trends.coverage.latestStableYear}; ausgeschlossen: ${trends.coverage.excludedYears.join(", ") || "keine Jahre"}. Mindestfallzahl: ${trends.methodology.minimumTrendRecords} pro Fenster.`));
  elements.emerging_grid.replaceChildren();
  const trendByTheme = new Map(trends.publicationTrends.map((trend) => [trend.theme, trend]));
  for (const signal of trends.emergingSignals) {
    const trend = trendByTheme.get(signal.theme);
    const card = node("article", "analysis-card");
    const heading = node("header");
    heading.append(statusChip(signal.status), node("h2", null, signal.label));
    card.append(heading);
    const metrics = node("dl", "mini-metrics");
    for (const [name, value] of [
      ["Korpusbelege", trend?.totals.absoluteCount ?? 0],
      ["Kurzfristiges Wachstum", signal.shortGrowthPercent === null ? "nicht berechenbar" : `${signal.shortGrowthPercent}%`],
      ["Preprint-Anteil", signal.recentPreprintShare === null ? "nicht berechenbar" : `${signal.recentPreprintShare}%`],
      ["Beschleunigung", trend?.accelerationPercentagePoints === null ? "nicht berechenbar" : `${trend.accelerationPercentagePoints} Pp.`]
    ]) {
      const row = node("div"); row.append(node("dt", null, name), node("dd", null, String(value))); metrics.append(row);
    }
    card.append(metrics);
    if (trend?.dataQuality.reasons?.length) {
      const details = node("details", "quality-details");
      details.append(node("summary", null, "Warum nicht belastbar?"));
      const list = node("ul");
      for (const reason of trend.dataQuality.reasons) list.append(node("li", null, reason));
      details.append(list); card.append(details);
    }
    elements.emerging_grid.append(card);
  }
}

function filteredCalls() {
  const now = Date.now();
  const query = normalizeSearchText(state.callFilters.query);
  const limitDays = Number(state.callFilters.deadline);
  const calls = (state.data.calls?.items ?? []).filter((call) => {
    const deadline = call.deadlineAt ? Date.parse(call.deadlineAt) : null;
    if (state.callFilters.deadline === "upcoming" && (!deadline || deadline < now || !["open", "closing-soon"].includes(call.status))) return false;
    if (Number.isFinite(limitDays) && (!deadline || deadline < now || deadline > now + limitDays * 86_400_000)) return false;
    if (["closing-soon", "open", "expired"].includes(state.callFilters.deadline) && call.status !== state.callFilters.deadline) return false;
    if (query && !normalizeSearchText([call.title, call.venue, call.description, ...(call.topics ?? [])].join(" ")).includes(query)) return false;
    return true;
  });
  return calls.sort((left, right) => {
    if (state.callFilters.sort === "venue") return left.venue.localeCompare(right.venue, "de");
    if (state.callFilters.sort === "verified") return String(right.lastVerifiedAt ?? "").localeCompare(String(left.lastVerifiedAt ?? ""));
    return (left.deadlineAt ? Date.parse(left.deadlineAt) : Number.MAX_SAFE_INTEGER) - (right.deadlineAt ? Date.parse(right.deadlineAt) : Number.MAX_SAFE_INTEGER);
  });
}

function renderCalls({ announceChange = false } = {}) {
  const calls = filteredCalls();
  elements.calls_table_body.replaceChildren();
  elements.calls_empty.hidden = Boolean(calls.length);
  elements.calls_caption.textContent = `${calls.length} Calls für den gewählten Deadline-Filter`;
  for (const call of calls) {
    const row = node("tr");
    const callCell = node("td");
    const title = node("a", "table-title", call.title);
    title.href = call.officialUrl; title.target = "_blank"; title.rel = "noopener noreferrer";
    callCell.append(title, node("span", "table-subline", call.venue));
    const deadlineCell = node("td");
    if (call.deadlineAt) { const time = node("time", null, formatDate(call.deadlineAt)); time.dateTime = call.deadlineAt; deadlineCell.append(time, node("span", "table-subline", call.deadlineTimezone)); }
    else deadlineCell.textContent = "Nicht angegeben";
    const statusCell = node("td"); statusCell.append(statusChip(call.status));
    row.append(callCell, node("td", null, label(call.callType)), deadlineCell, statusCell, node("td", null, formatDate(call.lastVerifiedAt)));
    elements.calls_table_body.append(row);
  }
  if (announceChange) announce(`${calls.length} Calls entsprechen dem Filter.`);
}

function renderOpportunities() {
  const trends = state.data.trends;
  if (!trends) {
    renderEmpty(elements.opportunity_grid, "Opportunities nicht verfügbar", "Die Analysedatei konnte nicht geladen werden.");
    return;
  }
  const calculated = trends.opportunities.filter((opportunity) => opportunity.score !== null).length;
  elements.opportunity_notice.replaceChildren(statusChip(trends.status), node("p", null, `${calculated} von ${trends.opportunities.length} Gesamtscores sind mit allen vier Komponenten berechenbar. Fehlende Komponenten bleiben leer.`));
  elements.opportunity_grid.replaceChildren();
  for (const opportunity of trends.opportunities) {
    const card = node("article", "analysis-card opportunity-card");
    const heading = node("header", "opportunity-heading");
    const score = node("strong", "opportunity-score", opportunity.score === null ? "–" : String(opportunity.score));
    score.setAttribute("aria-label", opportunity.score === null ? "Gesamtscore nicht berechenbar" : `Gesamtscore ${opportunity.score} von ${opportunity.maximum}`);
    const copy = node("div"); copy.append(statusChip(opportunity.status), node("h2", null, opportunity.label));
    heading.append(copy, score); card.append(heading);
    const components = node("div", "component-list");
    for (const component of opportunity.components) {
      const row = node("div", "component-row");
      const top = node("div", "component-label");
      top.append(node("span", null, COMPONENT_LABELS[component.key] ?? component.key), node("strong", null, component.score === null ? "nicht verfügbar" : `${component.score}/${component.maximum}`));
      row.append(top); renderComponentBar(row, component.score, component.maximum, COMPONENT_LABELS[component.key] ?? component.key); components.append(row);
    }
    card.append(components, node("p", "uncertainty-copy", `Unsicherheit: ${label(opportunity.uncertainty.level)}. ${opportunity.uncertainty.reasons.join(" ") || "Keine zusätzlichen Einschränkungen."}`));
    elements.opportunity_grid.append(card);
  }
}

function renderMethod() {
  const { meta, trends, health } = state.data;
  elements.method_cards.replaceChildren();
  const methodology = trends?.methodology;
  const cards = methodology ? [
    ["Gleiche Fenster", `${methodology.shortWindowYears} Jahre kurz, ${methodology.longWindowYears} Jahre lang; nur angrenzende gleich lange Zeiträume.`],
    ["Mindestfallzahl", `Mindestens ${methodology.minimumTrendRecords} Themenarbeiten in jedem Vergleichsfenster.`],
    ["Indexierungsverzug", `Laufendes Jahr ausgeschlossen; ${methodology.indexingLagDays} Tage zusätzliche Reserve zu Jahresbeginn.`],
    ["Keine Ersatzscores", "Opportunity-Gesamtscore nur, wenn alle vier Komponenten verfügbar sind."]
  ] : [["Methodik nicht verfügbar", "trends.json konnte nicht geladen werden."]];
  cards.forEach(([title, copy], index) => { const card = node("article", "panel method-card"); card.append(node("span", "method-step", String(index + 1).padStart(2, "0")), node("h2", null, title), node("p", null, copy)); elements.method_cards.append(card); });

  elements.version_list.replaceChildren();
  for (const [name, version] of Object.entries(meta?.methodVersions ?? {})) {
    const group = node("div"); group.append(node("dt", null, label(name)), node("dd", null, version)); elements.version_list.append(group);
  }
  elements.warning_list.replaceChildren();
  for (const warning of meta?.dataQualityWarnings ?? []) {
    const item = node("li", `warning-${warning.severity}`); item.append(statusChip(warning.severity), node("span", null, warning.message)); elements.warning_list.append(item);
  }
  if (!(meta?.dataQualityWarnings ?? []).length) elements.warning_list.append(node("li", null, "Keine Datenqualitätswarnungen."));

  elements.source_table_body.replaceChildren();
  for (const source of health?.sources ?? []) {
    const row = node("tr");
    const sourceCell = node("td"); sourceCell.append(node("strong", null, source.source), node("span", "table-subline", (source.modes ?? []).join(", ") || "–"));
    const statusCell = node("td"); statusCell.append(statusChip(source.status));
    row.append(sourceCell, node("td", null, label(source.role)), statusCell, node("td", null, String(source.recordCount)), node("td", null, formatDate(source.lastSuccessfulAt, true)));
    elements.source_table_body.append(row);
  }
}

function renderAll() {
  determineNewWorks();
  elements.shortlist_count.textContent = String(state.shortlist.size);
  populateWorkFilters();
  renderOverview();
  renderWorkResults();
  renderLandscape();
  renderEmerging();
  renderCalls();
  renderOpportunities();
  renderMethod();
  elements.footer_version.textContent = state.data.meta?.analysisVersion ?? "Statisches GitHub-Pages-Dashboard";
  elements.footer_updated.textContent = `Letzte erfolgreiche Ingestion ${formatDate(state.data.meta?.lastSuccessfulIngestionAt, true)}`;
}

async function loadDashboard() {
  state.loadErrors.clear();
  setDashboardState("loading");
  try {
    state.data.meta = await fetchJson(DATA_URLS.meta);
  } catch (error) {
    setDashboardState("error");
    elements.error_message.textContent = error instanceof Error ? error.message : "meta.json konnte nicht gelesen werden.";
    return;
  }
  const loaders = { works: loadWorks(), documents: fetchJson(DATA_URLS.search).then((data) => data.documents ?? []), calls: fetchJson(DATA_URLS.calls), trends: fetchJson(DATA_URLS.trends), questions: fetchJson(DATA_URLS.questions), health: fetchJson(DATA_URLS.health) };
  const entries = Object.entries(loaders);
  const results = await Promise.allSettled(entries.map(([, promise]) => promise));
  results.forEach((result, index) => {
    const key = entries[index][0];
    if (result.status === "fulfilled") state.data[key] = result.value;
    else { state.loadErrors.set(key, result.reason); state.data[key] = Array.isArray(state.data[key]) ? [] : null; }
  });
  const dashboardState = state.loadErrors.size || state.data.meta.status === "partial" ? "partial" : state.data.meta.status === "ready" ? "ready" : "empty";
  const message = state.loadErrors.size ? `${state.loadErrors.size} Datenbereich(e) konnten nicht geladen werden; verfügbare Bereiche bleiben nutzbar.` : state.data.meta.message;
  setDashboardState(dashboardState, message);
  renderAll();
  showView(viewFromHash());
  announce(`Dashboard geladen: ${state.data.works.length} Arbeiten und ${state.data.calls?.items?.length ?? 0} Calls.`);
}

function syncWorkFilters() {
  state.workFilters = {
    query: elements.work_query.value,
    year: elements.filter_year.value,
    source: elements.filter_source.value,
    type: elements.filter_type.value,
    theme: elements.filter_theme.value,
    mode: elements.filter_mode.value,
    dataStatus: elements.filter_data_status.value,
    sort: elements.work_sort.value,
    shortlistOnly: elements.shortlist_only.checked
  };
  state.workPage = 1;
  renderWorkResults({ announceChange: true });
}

elements.nav_toggle.addEventListener("click", () => {
  const open = elements.nav_toggle.getAttribute("aria-expanded") !== "true";
  elements.nav_toggle.setAttribute("aria-expanded", String(open));
  elements.primary_nav_list.classList.toggle("is-open", open);
});
elements.primary_nav_list.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const index = elements.navLinks.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const target = event.key === "Home" ? 0 : event.key === "End" ? elements.navLinks.length - 1 : event.key === "ArrowRight" ? (index + 1) % elements.navLinks.length : (index - 1 + elements.navLinks.length) % elements.navLinks.length;
  elements.navLinks[target].focus();
});
elements.nav.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeNavigation(); elements.nav_toggle.focus(); } });
elements.primary_nav_list.addEventListener("click", (event) => { if (event.target.closest(".nav-link")) closeNavigation(); });
window.addEventListener("hashchange", () => showView(viewFromHash(), { moveFocus: true }));
elements.retry_button.addEventListener("click", loadDashboard);
elements.work_filters.addEventListener("input", syncWorkFilters);
elements.work_filters.addEventListener("change", syncWorkFilters);
elements.work_filters.addEventListener("reset", () => window.setTimeout(() => { state.workFilters = { query: "", year: "all", source: "all", type: "all", theme: "all", mode: "all", dataStatus: "all", sort: "newest", shortlistOnly: false }; state.workPage = 1; renderWorkResults({ announceChange: true }); }, 0));
elements.work_results.addEventListener("click", (event) => { const button = event.target.closest("[data-shortlist-id]"); if (button) updateShortlist(button.dataset.shortlistId); });
elements.work_pagination.addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (!button || button.disabled) return; state.workPage = Number(button.dataset.page); renderWorkResults({ announceChange: true }); elements.work_result_count.focus?.(); window.scrollTo({ top: elements.work_result_count.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" }); });
elements.shortlist_jump.addEventListener("click", () => { window.location.hash = "new"; elements.shortlist_only.checked = true; syncWorkFilters(); window.setTimeout(() => elements.shortlist_only.focus(), 0); });
elements.export_csv.addEventListener("click", () => { const works = currentWorkResults().map((result) => result.work); download("human-ai-research-radar.csv", worksToCsv(works), "text/csv;charset=utf-8"); announce(`${works.length} Arbeiten als CSV exportiert.`); });
elements.export_bibtex.addEventListener("click", () => { const works = currentWorkResults().map((result) => result.work); download("human-ai-research-radar.bib", worksToBibtex(works), "application/x-bibtex;charset=utf-8"); announce(`${works.length} Arbeiten als BibTeX exportiert.`); });
elements.call_filters.addEventListener("input", () => { state.callFilters = { deadline: elements.deadline_filter.value, query: elements.call_query.value, sort: elements.call_sort.value }; renderCalls({ announceChange: true }); });
elements.call_filters.addEventListener("change", () => { state.callFilters = { deadline: elements.deadline_filter.value, query: elements.call_query.value, sort: elements.call_sort.value }; renderCalls({ announceChange: true }); });

if (!VIEW_IDS.includes(window.location.hash.slice(1).toLocaleLowerCase("en"))) window.history.replaceState(null, "", "#overview");
showView(viewFromHash());
loadDashboard();
document.documentElement.dataset.staticDashboard = "ready";
