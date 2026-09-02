import type { CallParserResult, OfficialCallSource, ParsedCall } from "../types";
import { assertMarkers, classifyCallThemes, dateNear, firstParagraph, officialUrl, plainText, sourceRecordId, validatedCalls } from "./shared";

export function parseAcmChi(source: OfficialCallSource, html: string): CallParserResult {
  const text = plainText(html);
  const structureMarkers = assertMarkers(source, text, [
    ["conference-name", /CHI 2027/i],
    ["important-dates", /Important Dates/i],
    ["papers-track", /Papers/i],
    ["workshops-track", /Workshops/i],
  ]);
  const description = firstParagraph(html, /human.computer interaction|human values|people and technology/i) || text.slice(0, 500);
  const eventDate = dateNear(text, /CHI 2027 will take place|conference(?: takes place| dates?)/i, 240);
  const importantDates = text.slice(text.search(/Important Dates/i));
  const definitions: Array<Pick<ParsedCall, "title" | "callType"> & { deadline: string | null; anchor: string }> = [
    { title: "ACM CHI 2027 Papers", callType: "conference", deadline: dateNear(importantDates, /Papers/i, 220), anchor: "important-dates" },
    { title: "ACM CHI 2027 Workshops", callType: "workshop", deadline: dateNear(importantDates, /Workshops/i, 220), anchor: "important-dates" },
  ];
  const calls = definitions.flatMap((definition) => {
    if (!definition.deadline) return [];
    const url = officialUrl(source, `#${definition.anchor}`);
    return [{
      sourceRecordId: sourceRecordId(definition.title, url),
      title: definition.title,
      callType: definition.callType,
      organizer: source.organization,
      description,
      officialUrl: url,
      submissionDeadline: definition.deadline,
      eventOrPublicationDate: eventDate,
      themes: classifyCallThemes(definition.title, description),
    } satisfies ParsedCall];
  });
  return { calls: validatedCalls(source, calls), structureMarkers };
}
