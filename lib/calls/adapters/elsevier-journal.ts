import type { CallParserResult, OfficialCallSource, ParsedCall } from "../types";
import { assertMarkers, classifyCallThemes, dateNear, elementBlocks, firstHeading, firstLink, firstParagraph, officialUrl, plainText, sourceRecordId, validatedCalls } from "./shared";

export function parseElsevierJournal(source: OfficialCallSource, html: string): CallParserResult {
  const text = plainText(html);
  const structureMarkers = assertMarkers(source, text, [
    ["call-heading", /Call(?:s)? for papers/i],
    ["deadline-label", /Submission deadline/i],
  ]);
  const candidates = [...elementBlocks(html, "article"), ...elementBlocks(html, "li")]
    .filter((block) => /Submission deadline/i.test(plainText(block)));
  const calls = candidates.flatMap((block) => {
    const blockText = plainText(block);
    const title = firstHeading(block) || firstLink(block)?.text;
    const link = firstLink(block, (href) => /\/special-issue\/|\/call-for-papers/i.test(href));
    const deadline = dateNear(blockText, /Submission deadline/i);
    if (!title || !link || !deadline) return [];
    const url = officialUrl(source, link.href);
    const description = firstParagraph(block) || blockText.slice(0, 500);
    return [{
      sourceRecordId: sourceRecordId(title, url),
      title,
      callType: "special_issue" as const,
      organizer: "Safety Science / Elsevier",
      description,
      officialUrl: url,
      submissionDeadline: deadline,
      eventOrPublicationDate: dateNear(blockText, /Publication date|Special issue publication/i),
      themes: classifyCallThemes(title, description),
    } satisfies ParsedCall];
  });
  return { calls: validatedCalls(source, calls), structureMarkers };
}
