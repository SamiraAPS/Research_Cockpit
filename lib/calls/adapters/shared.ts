import { normalizeTitle } from "../../radar/config";
import type { OfficialCallSource, ParsedCall } from "../types";

export class ParserContractError extends Error {
  constructor(readonly sourceKey: string, message: string) {
    super(message);
    this.name = "ParserContractError";
  }
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const CALL_THEME_TERMS: Record<string, readonly string[]> = {
  learning: ["learning", "training", "deskilling", "expertise"],
  trust: ["trust", "reliance", "automation bias"],
  agency: ["agency", "autonomy", "algorithmic management", "work design", "job design"],
  cognition: ["cognitive", "situation awareness", "workload", "decision support", "human factors", "ergonomics"],
  teaming: ["human-ai", "human–ai", "human machine", "human-machine", "human robot", "human-robot", "cobot", "collaboration"],
  motivation: ["motivation", "engagement", "meaningful work", "wellbeing", "well-being"],
  safety: ["safety", "resilience", "risk", "oversight", "critical system"],
  participation: ["participation", "participatory", "fairness", "inclusion", "worker voice", "governance", "polarization"],
};

export function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&ndash;", "–")
    .replaceAll("&mdash;", "—")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function plainText(html: string) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function elementBlocks(html: string, element: "article" | "li" | "section") {
  return [...html.matchAll(new RegExp(`<${element}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${element}>`, "gi"))].map((match) => match[0]);
}

export function firstHeading(html: string) {
  const match = html.match(/<h[1-3](?:\s[^>]*)?>([\s\S]*?)<\/h[1-3]>/i);
  return match ? plainText(match[1]) : null;
}

export function firstParagraph(html: string, containing?: RegExp) {
  const paragraphs = [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)].map((match) => plainText(match[1])).filter(Boolean);
  const value = containing ? paragraphs.find((paragraph) => containing.test(paragraph)) : paragraphs[0];
  return value?.slice(0, 500) ?? "";
}

export function firstLink(html: string, predicate?: (href: string, text: string) => boolean) {
  for (const match of html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1]);
    const text = plainText(match[2]);
    if (!predicate || predicate(href, text)) return { href, text };
  }
  return null;
}

export function officialUrl(source: OfficialCallSource, href?: string | null) {
  const url = new URL(href || source.url, source.url);
  if (url.protocol !== "https:" || !source.allowedHosts.includes(url.hostname)) {
    throw new ParserContractError(source.key, `Adapter produced a non-official URL: ${url.toString()}`);
  }
  url.hash = "";
  return url.toString();
}

export function parseOfficialDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = plainText(value)
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/(\d{1,2})\s*[-–]\s*\d{1,2}([,.]?\s+20\d{2})/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dayFirst = normalized.match(/\b(\d{1,2})[.,]?\s+([A-Za-z]+)[.,]?\s+(20\d{2})\b/);
  const monthFirst = normalized.match(/\b([A-Za-z]+)[.]?\s+(\d{1,2})[.,]?\s+(20\d{2})\b/);
  const match = dayFirst
    ? { day: Number(dayFirst[1]), month: MONTHS[dayFirst[2].toLowerCase()], year: Number(dayFirst[3]) }
    : monthFirst
      ? { day: Number(monthFirst[2]), month: MONTHS[monthFirst[1].toLowerCase()], year: Number(monthFirst[3]) }
      : null;
  if (!match?.month || match.day < 1 || match.day > 31) return null;
  return `${match.year}-${String(match.month).padStart(2, "0")}-${String(match.day).padStart(2, "0")}`;
}

export function dateNear(text: string, label: RegExp, distance = 180) {
  const match = label.exec(text);
  if (!match) return null;
  return parseOfficialDate(text.slice(match.index, match.index + distance));
}

export function classifyCallThemes(title: string, description: string) {
  const text = `${title} ${description}`.toLocaleLowerCase("en");
  const themes = Object.entries(CALL_THEME_TERMS)
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([theme]) => theme);
  return themes.length ? themes.slice(0, 4) : ["cross-cutting"];
}

export function sourceRecordId(title: string, url: string) {
  return `${normalizeTitle(title).replaceAll(" ", "-").slice(0, 90)}:${new URL(url).pathname}`;
}

export function assertMarkers(source: OfficialCallSource, text: string, markers: Array<[string, RegExp]>) {
  const missing = markers.filter(([, pattern]) => !pattern.test(text)).map(([name]) => name);
  if (missing.length) throw new ParserContractError(source.key, `Expected page markers are missing: ${missing.join(", ")}`);
  return markers.map(([name]) => name);
}

export function validatedCalls(source: OfficialCallSource, calls: ParsedCall[]) {
  if (calls.length === 0) throw new ParserContractError(source.key, "No calls matched the source-specific parser contract");
  return calls.map((call) => ({ ...call, officialUrl: officialUrl(source, call.officialUrl) }));
}
