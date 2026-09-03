import {
  agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, firstParagraph, parserResult, plainText
} from "./shared.mjs";

export function parseChi2027(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["conference", /CHI 2027/i],
    ["important-dates", /Important Dates/i],
    ["papers", /Papers/i],
    ["workshops", /Workshops/i]
  ]);
  const description = firstParagraph(html, /human.computer interaction|human flourishing|people and technology/i);
  const eventDate = dateNear(text, /(?:ACM CHI 2027 Pittsburgh|CHI 2027 will take place)/i, 120);
  const importantDates = text.slice(text.search(/Important Dates/i));
  const definitions = [
    ["Papers", "papers", /Papers/i, 100],
    ["Workshops", "workshop", /Workshops/i, 120],
    ["Posters", "papers", /Posters/i, 100],
    ["Interactive Demos", "conference", /Interactive Demos/i, 100],
    ["Panels", "conference", /Panels/i, 100],
    ["Student Research Competition", "conference", /Student Research Competition/i, 100]
  ];
  const calls = definitions.flatMap(([label, callType, pattern, distance]) => {
    const date = dateNear(importantDates, pattern, distance);
    return date ? [callRecord(source, {
      title: `${source.venue} – ${label}`,
      callType,
      description,
      deadlineAt: deadlineAt(date, source.deadlineTimezone),
      eventDate
    })] : [];
  });
  if (!calls.length) throw new Error("CHI-Parser fand trotz gültiger Marker keine Submission-Deadline");
  return parserResult(source, calls, definitions.map(([label]) => agendaSignal(source, "track", label)), markers);
}
