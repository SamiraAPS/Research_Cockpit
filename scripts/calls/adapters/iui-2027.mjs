import { agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, firstParagraph, parserResult, plainText } from "./shared.mjs";

export function parseIui2027(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["conference", /IUI 2027|2027 ACM Conference on Intelligent User Interfaces/i],
    ["important-dates", /Important Dates/i],
    ["papers", /Papers/i]
  ]);
  const description = firstParagraph(html, /intersection of Artificial Intelligence|machine intelligence|Intelligent User Interfaces/i);
  const eventDate = dateNear(text, /February\s+8/i, 80);
  const importantDates = text.slice(text.search(/Important Dates/i));
  const definitions = [
    ["Papers", "papers", /Papers \(Full Document\)|Full Paper Submission/i],
    ["Workshop Proposals", "workshop", /Workshop Proposals/i],
    ["Tutorial Proposals", "conference", /Tutorial Proposals/i],
    ["Doctoral Consortium", "conference", /Doctoral Consortium/i],
    ["Posters & Demos", "conference", /Posters\s*(?:&|and)\s*Demos/i]
  ];
  const calls = definitions.flatMap(([label, callType, pattern]) => {
    const date = dateNear(importantDates, pattern, 110);
    return date ? [callRecord(source, {
      title: `${source.venue} – ${label}`,
      callType,
      description,
      deadlineAt: deadlineAt(date, source.deadlineTimezone),
      eventDate
    })] : [];
  });
  if (!calls.length) throw new Error("IUI-Parser fand trotz gültiger Marker keine Submission-Deadline");
  return parserResult(source, calls, definitions.map(([label]) => agendaSignal(source, "track", label)), markers);
}
