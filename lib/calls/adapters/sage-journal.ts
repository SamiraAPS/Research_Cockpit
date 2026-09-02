import type { CallParserResult, OfficialCallSource, ParsedCall } from "../types";
import { assertMarkers, classifyCallThemes, dateNear, elementBlocks, firstHeading, firstLink, firstParagraph, officialUrl, plainText, sourceRecordId, validatedCalls } from "./shared";

export function parseSageJournal(source: OfficialCallSource, html: string): CallParserResult {
  const text = plainText(html);
  const structureMarkers = assertMarkers(source, text, [
    ["call-heading", /Call(?:s)? for Papers/i],
    ["journal-name", /Human Relations/i],
    ["deadline-label", /deadline|submissions?.*due/i],
  ]);
  const candidates = [...elementBlocks(html, "article"), ...elementBlocks(html, "li")]
    .filter((block) => /deadline|submissions?.*due/i.test(plainText(block)));
  const calls = candidates.flatMap((block) => {
    const blockText = plainText(block);
    const title = firstHeading(block) || firstLink(block)?.text;
    const link = firstLink(block, (href) => /\/doi\/|\/call-for-papers\//i.test(href));
    const deadline = dateNear(blockText, /deadline|submissions?.*due|proposals? by/i, 240);
    if (!title || !link || !deadline) return [];
    const url = officialUrl(source, link.href);
    const description = firstParagraph(block) || blockText.slice(0, 500);
    return [{
      sourceRecordId: sourceRecordId(title, url),
      title,
      callType: /proposal/i.test(title) ? "papers" as const : "special_issue" as const,
      organizer: "Human Relations / SAGE",
      description,
      officialUrl: url,
      submissionDeadline: deadline,
      eventOrPublicationDate: dateNear(blockText, /Publication date|Issue published/i),
      themes: classifyCallThemes(title, description),
    } satisfies ParsedCall];
  });
  return { calls: validatedCalls(source, calls), structureMarkers };
}
