import { createHash } from "node:crypto";

import { normalizeTitle } from "../../ingestion/normalize.mjs";

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

const TOPIC_TERMS = {
  "human–AI interaction": ["human-ai", "human–ai", "human ai", "intelligent user", "artificial intelligence", "machine intelligence"],
  "human–robot interaction": ["human-robot", "human–robot", "human robot", "robotics"],
  "human factors": ["human factors", "human systems", "human performance"],
  ergonomics: ["ergonomics", "work systems"],
  "work design": ["work design", "organization of work", "working lives", "labor market", "workplace"],
  safety: ["safety", "resilience", "risk"],
  collaboration: ["collaboration", "cooperation", "teaming", "teamwork"],
  trust: ["trust", "reliance"],
  participation: ["participation", "participatory", "inclusion", "polarization"],
  design: ["design", "interactive systems", "interaction design"],
  HCI: ["human-computer interaction", "human–computer interaction", "hci"]
};

export class ParserContractError extends Error {
  constructor(sourceKey, message) {
    super(message);
    this.name = "ParserContractError";
    this.sourceKey = sourceKey;
  }
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&ndash;", "–")
    .replaceAll("&mdash;", "—")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function plainText(html) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function elementBlocks(html, elements = ["article", "li"]) {
  return elements.flatMap((element) => [...String(html).matchAll(new RegExp(`<${element}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${element}>`, "gi"))].map((match) => match[0]));
}

export function headings(html) {
  return [...String(html).matchAll(/<h([1-4])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => plainText(match[2]))
    .filter(Boolean);
}

export function firstHeading(html) {
  return headings(html)[0] ?? null;
}

export function firstParagraph(html, matching) {
  const values = [...String(html).matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((match) => plainText(match[1]))
    .filter(Boolean);
  const selected = matching ? values.find((value) => matching.test(value)) : values[0];
  return selected?.slice(0, 600) ?? "";
}

export function firstLink(html, matching) {
  for (const match of String(html).matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1]);
    const label = plainText(match[2]);
    if (!matching || matching(href, label)) return { href, label };
  }
  return null;
}

export function parseDate(value) {
  const normalized = plainText(value)
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\bSept\.?\b/gi, "Sep")
    .replace(/\s+/g, " ");
  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const crossMonthRange = normalized.match(/\b(\d{1,2})\s+([A-Za-z]+)\s*[–-]\s*\d{1,2}\s+[A-Za-z]+[.,]?\s+(20\d{2})\b/);
  if (crossMonthRange) return validDate(Number(crossMonthRange[3]), MONTHS[crossMonthRange[2].toLowerCase()], Number(crossMonthRange[1]));
  const dayRange = normalized.match(/\b(\d{1,2})\s*[–-]\s*\d{1,2}\s+([A-Za-z]+)[.,]?\s+(20\d{2})\b/);
  if (dayRange) return validDate(Number(dayRange[3]), MONTHS[dayRange[2].toLowerCase()], Number(dayRange[1]));
  const monthRange = normalized.match(/\b([A-Za-z]+)[.]?\s+(\d{1,2})\s*[–-]\s*\d{1,2}[.,]?\s+(20\d{2})\b/);
  if (monthRange) return validDate(Number(monthRange[3]), MONTHS[monthRange[1].toLowerCase()], Number(monthRange[2]));
  const dayFirst = normalized.match(/\b(\d{1,2})[.,]?\s+([A-Za-z]+)[.,]?\s+(20\d{2})\b/);
  if (dayFirst) return validDate(Number(dayFirst[3]), MONTHS[dayFirst[2].toLowerCase()], Number(dayFirst[1]));
  const monthFirst = normalized.match(/\b([A-Za-z]+)[.]?\s+(\d{1,2})[.,]?\s+(20\d{2})\b/);
  if (monthFirst) return validDate(Number(monthFirst[3]), MONTHS[monthFirst[1].toLowerCase()], Number(monthFirst[2]));
  return null;
}

function validDate(year, month, day) {
  if (!month) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dateNear(text, label, distance = 220) {
  const match = label.exec(text);
  if (!match) return null;
  return parseDate(text.slice(match.index, match.index + distance));
}

export function deadlineAt(date, timezone) {
  if (!date) return null;
  if (timezone === "AoE") return `${date}T23:59:59-12:00`;
  if (timezone === "America/New_York") return `${date}T23:59:59-05:00`;
  return `${date}T23:59:59Z`;
}

export function officialUrl(source, href = source.officialUrl) {
  const url = new URL(href, source.officialUrl);
  if (url.protocol !== "https:" || !source.allowedHosts.includes(url.hostname)) {
    throw new ParserContractError(source.key, `Parser erzeugte eine URL außerhalb des freigegebenen offiziellen Hosts: ${url}`);
  }
  url.hash = "";
  return url.toString();
}

export function assertMarkers(source, text, markers) {
  const missing = markers.filter(([, pattern]) => !pattern.test(text)).map(([name]) => name);
  if (missing.length) throw new ParserContractError(source.key, `Erwartete Seitenmarker fehlen: ${missing.join(", ")}`);
  return markers.map(([name]) => name);
}

export function topicsFromText(...values) {
  const text = values.join(" ").toLocaleLowerCase("en");
  return Object.entries(TOPIC_TERMS)
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([topic]) => topic);
}

export function sourceRecordId(source, title, url) {
  return `${source.key}:${sha256(`${normalizeTitle(title)}|${new URL(url).pathname}`).slice(0, 16)}`;
}

export function callRecord(source, input) {
  const url = officialUrl(source, input.officialUrl);
  const title = plainText(input.title);
  const description = plainText(input.description).slice(0, 600);
  if (!title || !description) throw new ParserContractError(source.key, "Call ohne Titel oder belegte Beschreibung");
  const topics = [...new Set(input.topics?.length ? input.topics : topicsFromText(title, description))];
  return {
    sourceRecordId: input.sourceRecordId ?? sourceRecordId(source, title, url),
    title,
    venue: source.venue,
    callType: input.callType,
    organizer: source.organization,
    description,
    officialUrl: url,
    opensAt: input.opensAt ?? null,
    deadlineAt: input.deadlineAt ?? null,
    deadlineTimezone: source.deadlineTimezone,
    eventDate: input.eventDate ?? null,
    topics
  };
}

export function agendaSignal(source, kind, label, context = null) {
  const cleanLabel = plainText(label);
  if (!cleanLabel) return null;
  return {
    id: `${source.key}:${kind}:${sha256(normalizeTitle(cleanLabel)).slice(0, 12)}`,
    kind,
    label: cleanLabel.slice(0, 240),
    context: context ? plainText(context).slice(0, 400) : null
  };
}

export function parserResult(source, calls, agendaSignals, structureMarkers) {
  const signals = agendaSignals.filter(Boolean);
  if (!Array.isArray(calls) || !Array.isArray(signals)) throw new ParserContractError(source.key, "Ungültiges Parser-Ergebnis");
  return { calls, agendaSignals: signals, structureMarkers };
}
