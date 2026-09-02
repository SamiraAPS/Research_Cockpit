import type { CallParserResult, OfficialCallSource, ParsedCall } from "../types";
import { assertMarkers, classifyCallThemes, dateNear, firstParagraph, officialUrl, plainText, sourceRecordId, validatedCalls } from "./shared";

export function parseAhfe(source: OfficialCallSource, html: string): CallParserResult {
  const text = plainText(html);
  const structureMarkers = assertMarkers(source, text, [
    ["conference-name", /AHFE 2027/i],
    ["submission-requirements", /Summary of Submission Requirements/i],
    ["abstract-deadline", /Abstract/i],
  ]);
  const title = "AHFE 2027 International Conference";
  const description = firstParagraph(html, /human factors|ergonomics|submission/i) || text.slice(0, 500);
  const deadline = dateNear(text, /Abstract(?:s)?(?: submission)?(?: requirement)?(?:s)?(?: and)?(?: deadline)?/i, 220);
  const eventDate = dateNear(text, /July 26(?:–|-| to )30,? 2027/i, 220) ?? dateNear(text, /conference dates?/i, 220);
  const url = officialUrl(source);
  const calls: ParsedCall[] = deadline ? [{
    sourceRecordId: sourceRecordId(title, url),
    title,
    callType: "conference",
    organizer: source.organization,
    description,
    officialUrl: url,
    submissionDeadline: deadline,
    eventOrPublicationDate: eventDate,
    themes: classifyCallThemes(title, description),
  }] : [];
  return { calls: validatedCalls(source, calls), structureMarkers };
}
