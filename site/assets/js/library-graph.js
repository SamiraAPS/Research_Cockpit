// Network view of the reference library: the same works, three kinds of links.
// Plain canvas, no dependencies. Positions are precomputed per link type.

// Fixed order: a colour belongs to a profile, not to its rank or to a filter result.
const PROFILE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
const NO_PROFILE_COLOR = "#8a918c";
const INK = "23, 33, 29";
const MODE_ORDER = ["citations", "similarity", "authors"];
const LABELLED_HUBS = 14;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function degreeTable(nodeCount, edges) {
  const degree = new Array(nodeCount).fill(0);
  for (const [a, b] of edges) { degree[a] += 1; degree[b] += 1; }
  return degree;
}

export function neighbourLists(nodeCount, edges) {
  const out = Array.from({ length: nodeCount }, () => []);
  const incoming = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of edges) { out[a].push(b); incoming[b].push(a); }
  return { out, incoming };
}

export function renderLibraryGraph(root, graph) {
  root.replaceChildren();
  const modes = MODE_ORDER.filter(mode => graph.modes?.[mode] && Array.isArray(graph.edges?.[mode]));
  if (!graph.nodes?.length || !modes.length) {
    root.append(el("p", "muted-copy", "Der Netzwerkgraph enthält noch keine Arbeiten."));
    return;
  }
  const profileIndex = new Map(graph.profiles.map((profile, index) => [profile.id, index]));
  const colorOf = node => PROFILE_COLORS[profileIndex.get(node.profile)] ?? NO_PROFILE_COLOR;
  const profileLabel = node => graph.profiles[profileIndex.get(node.profile)]?.label ?? "ohne Profil";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const state = {
    mode: graph.modes[modes[0]].status === "ready" || modes.length === 1 ? modes[0] : modes[1],
    profile: "all", query: "", selected: null, hovered: null,
    scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0,
    current: [], animation: null
  };
  state.current = graph.nodes.map(node => [...node.positions[state.mode]]);
  const derived = {};
  for (const mode of modes) {
    derived[mode] = { degree: degreeTable(graph.nodes.length, graph.edges[mode]), ...neighbourLists(graph.nodes.length, graph.edges[mode]) };
  }

  // --- controls -----------------------------------------------------------
  const toolbar = el("div", "graph-toolbar");
  const modeGroup = el("div", "graph-modes");
  modeGroup.setAttribute("role", "group");
  modeGroup.setAttribute("aria-label", "Art der Verbindung");
  const modeButtons = new Map(modes.map((mode) => {
    const button = el("button", "graph-mode-button", graph.modes[mode].label);
    button.type = "button"; button.dataset.mode = mode;
    button.addEventListener("click", () => setMode(mode));
    modeGroup.append(button);
    return [mode, button];
  }));
  const profileField = el("label", "graph-field", "Themenprofil");
  const profileSelect = el("select");
  profileSelect.append(new Option("Alle Profile", "all"), ...graph.profiles.map(profile => new Option(profile.label, profile.id)));
  profileField.append(profileSelect);
  const searchField = el("label", "graph-field", "Arbeit oder Autor:in suchen");
  const searchInput = el("input");
  searchInput.type = "search"; searchInput.placeholder = "z. B. Parker, Trust, Co-Learning"; searchInput.autocomplete = "off";
  searchField.append(searchInput);
  const zoomGroup = el("div", "graph-zoom");
  const zoomIn = el("button", "graph-button", "+"); zoomIn.type = "button"; zoomIn.setAttribute("aria-label", "Vergrössern");
  const zoomOut = el("button", "graph-button", "−"); zoomOut.type = "button"; zoomOut.setAttribute("aria-label", "Verkleinern");
  const zoomReset = el("button", "graph-button", "Ansicht zurücksetzen"); zoomReset.type = "button";
  zoomGroup.append(zoomOut, zoomIn, zoomReset);
  toolbar.append(modeGroup, profileField, searchField);

  const description = el("p", "muted-copy graph-description");
  const legend = el("ul", "graph-legend");
  legend.setAttribute("aria-label", "Farben der Themenprofile");
  for (const profile of graph.profiles) {
    const item = el("li");
    const button = el("button", "graph-legend-button"); button.type = "button"; button.dataset.profile = profile.id;
    const swatch = el("span", "graph-swatch"); swatch.style.background = PROFILE_COLORS[profileIndex.get(profile.id)] ?? NO_PROFILE_COLOR; swatch.setAttribute("aria-hidden", "true");
    button.append(swatch, document.createTextNode(profile.label));
    button.addEventListener("click", () => { profileSelect.value = state.profile === profile.id ? "all" : profile.id; profileSelect.dispatchEvent(new Event("change")); });
    item.append(button); legend.append(item);
  }

  const stage = el("div", "graph-stage");
  const canvasWrap = el("div", "graph-canvas-wrap");
  const canvas = el("canvas", "graph-canvas");
  canvas.setAttribute("role", "img"); canvas.tabIndex = 0;
  const tooltip = el("div", "graph-tooltip"); tooltip.hidden = true;
  canvasWrap.append(canvas, zoomGroup, tooltip);
  const detail = el("aside", "graph-detail");
  detail.setAttribute("aria-live", "polite");
  stage.append(canvasWrap, detail);

  const tableDetails = el("details", "graph-table");
  const tableSummary = el("summary", null, "Als Tabelle anzeigen");
  const tableScroll = el("div", "table-scroll");
  tableDetails.append(tableSummary, tableScroll);

  root.append(toolbar, description, legend, stage, tableDetails);
  const context = canvas.getContext("2d");

  // --- geometry -----------------------------------------------------------
  const padding = 28;
  const toScreen = ([x, y]) => {
    const size = Math.min(state.width, state.height) - padding * 2;
    return [(state.width - size) / 2 + x * size, (state.height - size) / 2 + y * size].map((value, axis) => value * state.scale + (axis ? state.offsetY : state.offsetX));
  };
  const radiusOf = index => Math.min(11, 3 + 1.15 * Math.sqrt(derived[state.mode].degree[index])) * Math.min(1.8, Math.max(0.8, Math.sqrt(state.scale)));

  function matchesFilter(index) {
    const node = graph.nodes[index];
    if (state.profile !== "all" && node.profile !== state.profile) return false;
    if (!state.query) return true;
    return `${node.title} ${node.authors.join(" ")} ${node.year ?? ""}`.toLocaleLowerCase("de").includes(state.query);
  }

  function neighboursOf(index) {
    const { out, incoming } = derived[state.mode];
    return new Set([...out[index], ...incoming[index]]);
  }

  function draw() {
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, state.width, state.height);
    const points = state.current.map(toScreen);
    const focus = state.selected ?? state.hovered;
    const near = focus === null ? null : neighboursOf(focus);
    const visible = graph.nodes.map((_, index) => matchesFilter(index));
    const filtered = state.profile !== "all" || Boolean(state.query);

    context.lineWidth = 1;
    for (const [a, b] of graph.edges[state.mode]) {
      const highlighted = focus !== null && (a === focus || b === focus);
      if (highlighted) continue;
      const dim = focus !== null || (filtered && !(visible[a] && visible[b]));
      if (dim && focus === null && !visible[a] && !visible[b]) continue;
      context.strokeStyle = `rgba(${INK}, ${dim ? 0.04 : 0.17})`;
      context.beginPath(); context.moveTo(...points[a]); context.lineTo(...points[b]); context.stroke();
    }
    if (focus !== null) {
      context.lineWidth = 1.6; context.strokeStyle = `rgba(${INK}, 0.7)`; context.fillStyle = `rgba(${INK}, 0.7)`;
      for (const [a, b] of graph.edges[state.mode]) {
        if (a !== focus && b !== focus) continue;
        context.beginPath(); context.moveTo(...points[a]); context.lineTo(...points[b]); context.stroke();
        if (graph.modes[state.mode].directed) arrowHead(points[a], points[b], radiusOf(b));
      }
    }

    const isDim = index => focus !== null ? index !== focus && !near.has(index) : filtered && !visible[index];
    const order = [...graph.nodes.keys()].sort((a, b) => Number(isDim(b)) - Number(isDim(a)) || derived[state.mode].degree[b] - derived[state.mode].degree[a]);
    for (const index of order) {
      const dim = isDim(index);
      const [x, y] = points[index];
      context.globalAlpha = dim ? 0.12 : 1;
      context.beginPath(); context.arc(x, y, radiusOf(index), 0, Math.PI * 2);
      context.fillStyle = colorOf(graph.nodes[index]); context.fill();
      context.lineWidth = index === state.selected ? 3 : 1;
      context.strokeStyle = index === state.selected ? `rgb(${INK})` : `rgba(${INK}, 0.55)`;
      context.stroke();
    }
    context.globalAlpha = 1;

    // Labels: the selected work with its neighbours, otherwise the best connected works in view.
    const labelled = focus !== null
      ? [focus, ...[...near].sort((a, b) => derived[state.mode].degree[b] - derived[state.mode].degree[a]).slice(0, 12)]
      : [...graph.nodes.keys()].filter(index => (!filtered || visible[index]) && derived[state.mode].degree[index] > 0)
        .sort((a, b) => derived[state.mode].degree[b] - derived[state.mode].degree[a]).slice(0, filtered ? 24 : LABELLED_HUBS);
    context.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    context.textBaseline = "middle";
    const boxes = [];
    for (const index of labelled) {
      const [x, y] = points[index];
      const node = graph.nodes[index];
      const text = [node.authors[0]?.split(",")[0], node.year].filter(Boolean).join(" ") || node.title.slice(0, 28);
      const width = context.measureText(text).width;
      const left = x + radiusOf(index) + 4;
      const box = [left, y - 8, left + width, y + 8];
      if (index !== focus && boxes.some(other => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue;
      if (left + width > state.width || y < 8 || y > state.height - 8) continue;
      boxes.push(box);
      context.lineWidth = 3; context.strokeStyle = "rgba(255, 254, 250, 0.92)"; context.strokeText(text, left, y);
      context.fillStyle = `rgb(${INK})`; context.fillText(text, left, y);
    }
  }

  function arrowHead(from, to, targetRadius) {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const tipX = to[0] - Math.cos(angle) * (targetRadius + 1), tipY = to[1] - Math.sin(angle) * (targetRadius + 1);
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(tipX - Math.cos(angle - 0.42) * 8, tipY - Math.sin(angle - 0.42) * 8);
    context.lineTo(tipX - Math.cos(angle + 0.42) * 8, tipY - Math.sin(angle + 0.42) * 8);
    context.closePath(); context.fill();
  }

  function resize() {
    const width = canvasWrap.clientWidth;
    if (!width) return;
    state.width = width; state.height = Math.round(Math.min(680, Math.max(420, width * 0.72)));
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(state.width * ratio); canvas.height = Math.round(state.height * ratio);
    canvas.style.height = `${state.height}px`;
    draw();
  }

  function nodeAt(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    const x = clientX - bounds.left, y = clientY - bounds.top;
    let best = null, bestDistance = Infinity;
    state.current.forEach((position, index) => {
      if (state.selected === null && (state.profile !== "all" || state.query) && !matchesFilter(index)) return;
      const [px, py] = toScreen(position);
      const distance = Math.hypot(px - x, py - y);
      if (distance <= radiusOf(index) + 5 && distance < bestDistance) { best = index; bestDistance = distance; }
    });
    return best;
  }

  // --- updates ------------------------------------------------------------
  function describe() {
    const mode = graph.modes[state.mode];
    const degree = derived[state.mode].degree;
    const isolated = degree.filter(value => value === 0).length;
    const parts = [mode.description, `${graph.edges[state.mode].length} Verbindungen zwischen ${graph.nodes.length} Arbeiten; ${isolated} ohne Verbindung in dieser Ansicht.`];
    if (state.mode === "citations") {
      if (mode.status !== "ready") parts.push(`Zitationsdaten sind derzeit nicht verfügbar${mode.message ? ` (${mode.message})` : ""}.`);
      else parts.push(`${mode.resolvedWorks} von ${graph.nodes.length} Arbeiten wurden über ihre DOI in OpenAlex gefunden; die übrigen haben hier keine Zitationsdaten.${mode.message ? ` ${mode.message}` : ""}`);
    }
    parts.push("Grösse eines Punkts: Anzahl Verbindungen. Farbe: Themenprofil.");
    description.textContent = parts.join(" ");
    canvas.setAttribute("aria-label", `Netzwerkgraph der Referenzbibliothek, Ansicht ${mode.label}: ${graph.edges[state.mode].length} Verbindungen zwischen ${graph.nodes.length} Arbeiten. Dieselben Angaben stehen in der Tabelle darunter.`);
  }

  function renderDetail() {
    detail.replaceChildren();
    if (state.selected === null) {
      detail.append(el("h3", null, "Arbeit auswählen"), el("p", "muted-copy", "Ein Klick auf einen Punkt zeigt die Arbeit und ihre Verbindungen in der gewählten Ansicht. Ziehen verschiebt, das Mausrad vergrössert."));
      return;
    }
    const node = graph.nodes[state.selected];
    const { out, incoming } = derived[state.mode];
    detail.append(el("p", "section-kicker", profileLabel(node)), el("h3", null, node.title));
    detail.append(el("p", "muted-copy", [node.authors.join("; ") || "Autor:innen nicht erfasst", node.year].filter(Boolean).join(" · ")));
    if (node.doi) {
      const link = el("a", "text-link", "Zur Publikation (DOI)");
      link.href = `https://doi.org/${node.doi}`; link.target = "_blank"; link.rel = "noopener noreferrer";
      const paragraph = el("p"); paragraph.append(link); detail.append(paragraph);
    }
    const groups = graph.modes[state.mode].directed
      ? [["Zitiert aus der Bibliothek", out[state.selected]], ["Wird zitiert von", incoming[state.selected]]]
      : [[state.mode === "authors" ? "Gemeinsame Autor:innen mit" : "Inhaltlich am nächsten", [...out[state.selected], ...incoming[state.selected]]]];
    for (const [heading, members] of groups) {
      detail.append(el("h4", null, `${heading} (${members.length})`));
      if (!members.length) { detail.append(el("p", "muted-copy", "Keine in dieser Ansicht.")); continue; }
      const list = el("ul", "graph-neighbours");
      for (const index of [...members].sort((a, b) => (graph.nodes[b].year ?? 0) - (graph.nodes[a].year ?? 0))) {
        const button = el("button", "graph-neighbour", graph.nodes[index].label); button.type = "button";
        button.addEventListener("click", () => select(index));
        list.append(el("li")); list.lastChild.append(button);
      }
      detail.append(list);
    }
    const clear = el("button", "graph-button", "Auswahl aufheben"); clear.type = "button";
    clear.addEventListener("click", () => select(null));
    detail.append(clear);
  }

  function renderTable() {
    const degree = derived[state.mode].degree;
    const rows = [...graph.nodes.keys()].filter(matchesFilter).sort((a, b) => degree[b] - degree[a] || graph.nodes[a].label.localeCompare(graph.nodes[b].label, "de"));
    const table = el("table", "data-table");
    table.append(el("caption", null, `${rows.length} Arbeiten, sortiert nach Anzahl Verbindungen (${graph.modes[state.mode].label})`));
    const head = el("thead"); const headRow = el("tr");
    for (const title of ["Arbeit", "Themenprofil", "Verbindungen"]) { const th = el("th", null, title); th.scope = "col"; headRow.append(th); }
    head.append(headRow);
    const body = el("tbody");
    for (const index of rows) {
      const row = el("tr");
      const button = el("button", "graph-neighbour", graph.nodes[index].label); button.type = "button";
      button.addEventListener("click", () => { select(index); canvas.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" }); });
      row.append(el("td")); row.lastChild.append(button);
      row.append(el("td", null, profileLabel(graph.nodes[index])), el("td", null, String(degree[index])));
      body.append(row);
    }
    table.append(head, body);
    tableScroll.replaceChildren(table);
  }

  function refresh() {
    for (const [mode, button] of modeButtons) button.setAttribute("aria-pressed", String(mode === state.mode));
    for (const button of legend.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.profile === state.profile));
    describe(); renderDetail(); renderTable(); draw();
  }

  function select(index) {
    state.selected = index;
    refresh();
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    const from = state.current.map(position => [...position]);
    const to = graph.nodes.map(node => node.positions[mode]);
    state.mode = mode;
    if (state.animation) cancelAnimationFrame(state.animation);
    if (reducedMotion) { state.current = to.map(position => [...position]); refresh(); return; }
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / 650);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
      state.current = from.map((position, index) => [position[0] + (to[index][0] - position[0]) * eased, position[1] + (to[index][1] - position[1]) * eased]);
      draw();
      state.animation = progress < 1 ? requestAnimationFrame(step) : null;
    };
    refresh();
    state.animation = requestAnimationFrame(step);
  }

  function zoomAt(factor, x = state.width / 2, y = state.height / 2) {
    const next = Math.min(8, Math.max(0.6, state.scale * factor));
    const applied = next / state.scale;
    state.offsetX = x - (x - state.offsetX) * applied; state.offsetY = y - (y - state.offsetY) * applied; state.scale = next;
    draw();
  }

  // --- events -------------------------------------------------------------
  profileSelect.addEventListener("change", () => { state.profile = profileSelect.value; refresh(); });
  searchInput.addEventListener("input", () => { state.query = searchInput.value.trim().toLocaleLowerCase("de"); refresh(); });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const degree = derived[state.mode].degree;
    const first = [...graph.nodes.keys()].filter(matchesFilter).sort((a, b) => degree[b] - degree[a])[0];
    if (state.query && first !== undefined) select(first);
  });
  zoomIn.addEventListener("click", () => zoomAt(1.4));
  zoomOut.addEventListener("click", () => zoomAt(1 / 1.4));
  zoomReset.addEventListener("click", () => { state.scale = 1; state.offsetX = 0; state.offsetY = 0; draw(); });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => { drag = { x: event.clientX, y: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", (event) => {
    if (drag) {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (drag.moved || Math.hypot(dx, dy) > 4) { drag.moved = true; state.offsetX += dx; state.offsetY += dy; drag.x = event.clientX; drag.y = event.clientY; tooltip.hidden = true; draw(); }
      return;
    }
    const index = nodeAt(event.clientX, event.clientY);
    if (index !== state.hovered) { state.hovered = index; draw(); }
    canvas.style.cursor = index === null ? "grab" : "pointer";
    if (index === null) { tooltip.hidden = true; return; }
    const node = graph.nodes[index];
    tooltip.replaceChildren(el("strong", null, node.label), el("span", null, `${profileLabel(node)} · ${derived[state.mode].degree[index]} Verbindungen`));
    const bounds = canvasWrap.getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(event.clientX - bounds.left + 14, state.width - 280)}px`;
    tooltip.style.top = `${event.clientY - bounds.top + 14}px`;
  });
  canvas.addEventListener("pointerup", (event) => {
    const wasDrag = drag?.moved; drag = null;
    if (!wasDrag) select(nodeAt(event.clientX, event.clientY));
  });
  canvas.addEventListener("pointerleave", () => { if (state.hovered !== null) { state.hovered = null; draw(); } tooltip.hidden = true; });
  canvas.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (moves[event.key]) { event.preventDefault(); state.offsetX += moves[event.key][0]; state.offsetY += moves[event.key][1]; draw(); }
    else if (event.key === "+" || event.key === "=") zoomAt(1.4);
    else if (event.key === "-") zoomAt(1 / 1.4);
    else if (event.key === "Escape") select(null);
  });
  new ResizeObserver(resize).observe(canvasWrap);

  refresh();
  resize();
}
