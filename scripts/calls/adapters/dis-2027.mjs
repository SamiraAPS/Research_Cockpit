import { agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, firstParagraph, parserResult, plainText } from "./shared.mjs";

export function parseDis2027(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["conference", /DIS 2027|Designing Interactive Systems/i],
    ["call", /Call for (?:papers|submissions)/i],
    ["important-dates", /Important Dates/i],
    ["paper-deadline", /Paper and Pictorial Submission/i]
  ]);
  const description = firstParagraph(html, /invite submissions|interactive systems|contribution areas/i);
  const deadline = dateNear(text, /Paper and Pictorial Submission/i, 100);
  const eventDate = dateNear(text, /DIS 2027 Conference/i, 100);
  if (!deadline) throw new Error("DIS-Parser fand trotz gültiger Marker keine Paper-Deadline");
  const call = callRecord(source, {
    title: `${source.venue} – Papers and Pictorials`,
    callType: "papers",
    description,
    deadlineAt: deadlineAt(deadline, source.deadlineTimezone),
    eventDate
  });
  return parserResult(source, [call], [
    agendaSignal(source, "track", "Papers"),
    agendaSignal(source, "track", "Pictorials")
  ], markers);
}
