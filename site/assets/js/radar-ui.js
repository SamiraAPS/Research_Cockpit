import { readWorkspace, writeWorkspace, validateWorkspace } from "./workspace.js";
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const areas = { "human-ai": "Psychologie, Arbeit & Human–AI", "human-factors": "Human Factors, Ergonomie & Work Design" };
const format = value => value === null ? "nicht berechenbar" : `${value > 0 ? "+" : ""}${value}%`;
const $ = id => document.getElementById(id);

export function renderSeries(container, series, caption) {
  container.replaceChildren();
  const figure = el("figure", "time-series");
  const maximum = Math.max(1, ...series.map(row => row.count));
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 760 260"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${caption}. Zahlen in der Tabelle unter dem Diagramm.`);
  const add = (tag, attrs, text) => { const n = document.createElementNS(namespace, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; svg.append(n); return n; };
  for (const fraction of [0, 0.5, 1]) { const y = 220 - fraction * 185; add("line", { x1: 52, x2: 750, y1: y, y2: y, stroke: "#d4dedb" }); add("text", { x: 45, y: y + 4, "text-anchor": "end", "font-size": 12, fill: "#475c59" }, Math.round(maximum * fraction)); }
  const width = 690 / Math.max(1, series.length);
  series.forEach((row, index) => {
    const height = row.count / maximum * 185, preprintHeight = row.preprints / maximum * 185;
    add("rect", { x: 55 + index * width, y: 220 - height, width: width * 0.72, height, fill: row.partialPeriod ? "#b7cbc5" : "#18776b" });
    add("rect", { x: 55 + index * width, y: 220 - preprintHeight, width: width * 0.72, height: preprintHeight, fill: "#cd883f" });
    if (series.length <= 12 || index % 3 === 0) add("text", { x: 55 + index * width, y: 242, "font-size": 11, fill: "#475c59" }, row.period);
  });
  figure.append(svg, el("figcaption", "muted-copy", `${caption}. Grün: Publikationen; Orange: aktuelle Preprints; hell: laufender Zeitraum. Erfasste Arbeiten, keine weltweiten Gesamtzahlen.`));
  const details = el("details", "quality-details"); details.append(el("summary", null, "Zahlen und Abdeckung anzeigen"));
  const scroll = el("div", "table-scroll"), table = el("table", "data-table");
  const head = el("thead"), tr = el("tr");
  for (const title of ["Zeitraum", "Works", "Preprints", "Abrufabdeckung"]) { const th = el("th", null, title); th.scope = "col"; tr.append(th); } head.append(tr); table.append(head);
  const body = el("tbody");
  for (const row of series) { const tr = el("tr"); for (const value of [row.period, row.count, row.preprints, row.coverage.complete ? "Abfragen vollständig; Relevanz unvalidiert" : "Lücken / neue Suchversion"]) tr.append(el("td", null, String(value))); body.append(tr); }
  table.append(body); scroll.append(table); details.append(scroll); container.append(figure, details);
}

export function noteEditor(id, announce) {
  const wrap = el("div", "note-editor"), label = el("label", null, "Eigene Notiz (nur auf diesem Gerät)");
  const input = el("textarea"); input.rows = 3; input.maxLength = 10000; input.value = readWorkspace().notes[id] ?? ""; input.setAttribute("aria-label", "Eigene Forschungsnotiz");
  input.addEventListener("input", () => { try { const value = readWorkspace(); value.notes[id] = input.value; writeWorkspace(value); } catch { announce("Notiz konnte nicht gespeichert werden. Bitte als Datei sichern."); } });
  label.append(input); wrap.append(label); return wrap;
}

function renderBoard(evidenceLinks, announce) {
  const container = $("project-board"); container.replaceChildren();
  const workspace = readWorkspace();
  if (!workspace.ideas.length) container.append(el("p", "muted-copy", "Noch keine Projektidee gespeichert. Speichere unten eine Idee und entwickle sie hier weiter."));
  for (const idea of workspace.ideas) {
    const card = el("article", "question-card"), select = el("select"); select.setAttribute("aria-label", "Projektstatus");
    for (const [value, label] of [["saved", "Gemerkt"], ["reading", "Literatur prüfen"], ["planning", "Studie planen"], ["archived", "Archiviert"]]) { const option = el("option", null, label); option.value = value; select.append(option); } select.value = idea.stage;
    select.addEventListener("change", () => { try { const data = readWorkspace(); data.ideas.find(row => row.id === idea.id).stage = select.value; writeWorkspace(data); } catch { announce("Projektstatus konnte nicht gespeichert werden."); } });
    card.append(el("h3", null, idea.question), select, evidenceLinks(idea.evidenceWorkIds), noteEditor(idea.id, announce)); container.append(card);
  }
}

export function renderRadarViews({ radar, works, calls, meta, evidenceLinks, announce, download }) {
  if (!radar) { $("radar-error").hidden = false; return; }
  $("radar-error").hidden = true;
  const draw = () => {
    const area = $("trend-area").value;
    const series = radar.series.find(row => row.area === area);
    if (!series) return;
    const field = meta.fieldCounts?.series.find(row => row.area === area);
    if (field?.annual.length) {
      renderSeries($("field-series"), field.annual, `OpenAlex-Suchtreffer (${field.status}), Stand ${field.generatedAt?.slice(0, 10)}`);
      const link = el("a", "text-link", "Exakte Datenbankabfrage öffnen"); link.href = field.queryUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; $("field-series").append(link);
    } else $("field-series").replaceChildren(el("p", "muted-copy", "Datenbankzählung noch nicht verfügbar. Beim nächsten Refresh wird die Jahresaggregation separat abgefragt."));
    renderSeries($("annual-series"), series.annual, `${areas[area]}: Jahreszahlen`);
    renderSeries($("monthly-series"), series.monthly, `${areas[area]}: letzte 24 Monate`);
    const summary = $("quarter-comparison"); summary.replaceChildren();
    summary.append(el("p", "muted-copy span-all", `Abgeschlossene Quartale: ${series.comparison.previousFrom}–${series.comparison.previousTo} → ${series.comparison.recentFrom}–${series.comparison.recentTo}. Absolute Zahl und relativer Korpusanteil können sich unterschiedlich entwickeln.`));
    for (const theme of series.comparison.themes) {
      const card = el("article", "question-card");
      card.append(el("h3", null, theme.label), el("p", null, `${theme.previous.count} → ${theme.recent.count} Arbeiten · Anzahl ${format(theme.observedCountChangePercent)} · Korpusanteil ${format(theme.observedShareChangePercent)}`), el("p", "muted-copy", `${theme.recent.preprints} aktuelle Preprints · ${theme.authorGroups} Autorengruppen · ${theme.venues} Venues`), el("p", "muted-copy", theme.interpretation === "descriptive-only" ? "Deskriptiver Vergleich, keine Vorhersage." : "Trendrichtung nicht belastbar: Abdeckung oder Fallzahl reicht nicht aus."), evidenceLinks(theme.evidenceWorkIds.slice(0, 3))); summary.append(card);
    }
  };
  $("trend-area").onchange = draw; draw();
  const clusters = $("emerging-grid"); clusters.replaceChildren();
  $("emerging-notice").replaceChildren(el("p", null, "Neue Themenkandidaten aus allen relevanten Suchmodi, einschließlich Preprints. Textähnlichkeit und Kontext werden gebündelt; Neuheit und Zukunftswachstum sind noch nicht bestätigt."));
  if (!radar.clusters.length) clusters.append(el("p", null, "Noch keine Cluster mit mindestens drei Arbeiten."));
  for (const cluster of radar.clusters) {
    const card = el("article", "analysis-card");
    card.append(el("span", "data-chip", cluster.method === "semantic-embedding" ? "Semantisches Cluster" : "Text-/Kontextcluster"), el("h2", null, cluster.label), el("p", null, `${cluster.workCount} Arbeiten im letzten Jahr · ${cluster.preprintCount} mit Preprint-Version · ${cluster.authorGroups} Autorengruppen`), el("p", "muted-copy", `Letzte 90 Tage: ${cluster.recentCount}; vorherige 90 Tage: ${cluster.previousCount}. Unvollständige Abdeckung; kein bestätigtes Wachstum.`), evidenceLinks(cluster.evidenceWorkIds.slice(0, 5)), el("p", "muted-copy", cluster.caveat));
    for (const eventId of cluster.agendaEventIds) { const event = radar.agenda.find(e => e.id === eventId); if (event) card.append(el("p", "muted-copy", `Thematisches Call-Signal: ${event.venue} (gemeinsames Thema; Passung prüfen)`)); }
    clusters.append(card);
  }
  const agenda = $("agenda-summary"); agenda.replaceChildren(el("p", null, `${radar.agenda.length} aktuell geprüfte Veranstaltungs-/Quellengruppen. Mehrere Tracks desselben Events zählen zusammen. Allgemeine Konferenzaufrufe und nahe Deadlines gelten nicht als neue Forschungstrends.`));
  for (const event of radar.agenda) agenda.append(el("p", "muted-copy", `${event.venue} · ${event.calls.length} Tracks · ${event.signalKind === "thematic-agenda" ? "thematisches Signal" : "allgemeiner Call"}`));
  const ideas = $("opportunity-grid"); ideas.replaceChildren();
  $("opportunity-notice").replaceChildren(el("p", null, "Projektideen sind prüfbare Vorschläge, keine nachgewiesenen Forschungslücken. Der bisherige Gesamtscore wurde entfernt."));
  for (const idea of radar.ideas) {
    const card = el("article", "analysis-card");
    card.append(el("span", "data-chip", "Hypothese zur Prüfung"), el("h2", null, idea.question), el("p", null, idea.observation), el("h3", null, "Mögliche Studie"), el("p", null, idea.proposedDesign), el("p", "muted-copy", idea.unresolved));
    const counter = el("ul"); idea.counterarguments.forEach(text => counter.append(el("li", null, text))); card.append(counter, evidenceLinks(idea.evidence.map(e => e.workId)));
    const evidence = el("details", "quality-details"); evidence.append(el("summary", null, "Textbelege für die Themenverbindung"));
    idea.evidence.forEach(item => evidence.append(el("blockquote", null, item.quote))); card.append(evidence);
    card.append(el("p", "muted-copy", `${idea.personalFitCount} Themenarbeiten passen zu Co-Learning, Motivation, kognitivem Engagement oder hochqualifizierter Arbeit.`));
    for (const id of idea.matchedEvents) { const event = radar.agenda.find(e => e.id === id); for (const callId of event?.topicalCalls ?? []) { const call = calls.items.find(c => c.id === callId); if (call) { const a = el("a", "text-link", call.title); a.href = call.officialUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; card.append(a); } } }
    const button = el("button", "secondary-button", readWorkspace().ideas.some(row => row.id === idea.id) ? "Im Projektboard" : "Idee speichern"); button.type = "button";
    button.onclick = () => { try { const value = readWorkspace(); if (!value.ideas.some(row => row.id === idea.id)) value.ideas.push({ id: idea.id, question: idea.question, evidenceWorkIds: idea.evidence.map(row => row.workId), stage: "saved", savedAt: new Date().toISOString() }); writeWorkspace(value); button.textContent = "Im Projektboard"; renderBoard(evidenceLinks, announce); announce("Idee auf diesem Gerät gespeichert."); } catch { announce("Speichern nicht möglich. Bitte Projektdatei exportieren."); } }; card.append(button); ideas.append(card);
  }
  renderBoard(evidenceLinks, announce);
  $("export-workspace").onclick = () => download("research-projects.json", JSON.stringify(readWorkspace(), null, 2), "application/json");
  $("import-workspace").onchange = async event => { try { const file = event.target.files[0]; if (!file) return; if (file.size > 2000000) throw new Error("Datei zu groß."); const incoming = validateWorkspace(JSON.parse(await file.text())), current = readWorkspace(); current.notes = { ...current.notes, ...incoming.notes }; current.ideas = [...new Map([...current.ideas, ...incoming.ideas].map(idea => [idea.id, idea])).values()]; writeWorkspace(current); renderBoard(evidenceLinks, announce); announce("Projektdatei importiert; vorhandene Einträge zusammengeführt."); } catch (error) { announce(`Import fehlgeschlagen: ${error.message}`); } finally { event.target.value = ""; } };
  const audit = $("radar-coverage"); audit.replaceChildren();
  audit.append(el("p", null, `Relevanzprüfung: ${radar.relevance.included} aufgenommen, ${radar.relevance.uncertain} unklar, ${radar.relevance.excluded} als technisch/fachfremd markiert. Alle bleiben durchsuchbar. ${radar.duplicateCandidates.length} mögliche Dublettengruppen benötigen Prüfung.`), el("p", null, `KI-Extraktion: ${radar.semanticCoverage?.extracted ?? 0}/${works.length} Arbeiten. Textbelege werden automatisch geprüft; Interpretationen sind nicht manuell validiert.`));
  const details = el("details"); details.append(el("summary", null, "Quellenabdeckung und getrennte Abrufspuren"));
  for (const row of radar.sourceCoverage) details.append(el("p", "muted-copy", `${row.venue}: ${Object.entries(row.countsByYear).map(([year, count]) => `${year}: ${count}`).join(" · ") || "keine Arbeiten beobachtet"}. Fehlende Abstracts: ${row.abstractMissing}.`));
  for (const [key, row] of Object.entries(meta.retrievalState?.streams ?? {})) details.append(el("p", "muted-copy", `${key}: ${row.range.from}–${row.range.to} · ${row.retrieved}/${row.found} Quellentreffer · ${row.complete ? "Abruf vollständig" : "unvollständig"}`));
  audit.append(details);
}
