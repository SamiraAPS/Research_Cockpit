function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderHorizontalBars(container, data, options = {}) {
  container.replaceChildren();
  const figure = element("figure", "bar-chart");
  figure.append(element("figcaption", "chart-caption", options.caption ?? "Verteilung"));
  const maximum = Math.max(1, ...data.map((entry) => entry.value ?? 0));
  const rows = element("div", "bar-chart-rows");

  for (const entry of data) {
    const row = element("div", "bar-chart-row");
    const label = element("span", "bar-chart-label", entry.label);
    const track = element("span", "bar-chart-track");
    track.setAttribute("aria-hidden", "true");
    const fill = element("span", "bar-chart-fill");
    fill.style.width = `${Math.max(0, ((entry.value ?? 0) / maximum) * 100)}%`;
    track.append(fill);
    const value = element("strong", "bar-chart-value", options.formatValue?.(entry.value, entry) ?? String(entry.value ?? 0));
    row.append(label, track, value);
    rows.append(row);
  }
  figure.append(rows);

  const alternative = element("details", "chart-alternative");
  alternative.append(element("summary", null, options.alternativeLabel ?? "Textalternative zum Diagramm"));
  const list = element("ul");
  for (const entry of data) list.append(element("li", null, `${entry.label}: ${options.formatValue?.(entry.value, entry) ?? entry.value ?? 0}`));
  alternative.append(list);
  figure.append(alternative);
  container.append(figure);
}

export function renderComponentBar(container, score, maximum, label) {
  const wrapper = element("div", "component-meter");
  wrapper.setAttribute("role", "img");
  wrapper.setAttribute("aria-label", score === null ? `${label}: nicht verfügbar` : `${label}: ${score} von ${maximum}`);
  const track = element("span", "component-meter-track");
  track.setAttribute("aria-hidden", "true");
  const fill = element("span", "component-meter-fill");
  fill.style.width = `${score === null ? 0 : Math.max(0, Math.min(100, (score / maximum) * 100))}%`;
  track.append(fill);
  wrapper.append(track);
  container.append(wrapper);
}
