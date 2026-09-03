import { agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, firstParagraph, parserResult, plainText } from "./shared.mjs";

export function parseAhfe2027(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["conference", /AHFE 2027/i],
    ["submissions", /Submission/i],
    ["abstract", /Abstract/i]
  ]);
  const description = firstParagraph(html, /human factors|ergonomics|submission/i);
  const deadline = dateNear(text, /Abstract(?:s)?(?: submission)?(?: deadline)?/i, 220);
  if (!deadline) throw new Error("AHFE-Parser fand trotz gültiger Marker keine Abstract-Deadline");
  const eventDate = dateNear(text, /(?:conference dates?|July 26)/i, 140);
  const call = callRecord(source, {
    title: `${source.venue} – Abstract Submissions`,
    callType: "conference",
    description,
    deadlineAt: deadlineAt(deadline, source.deadlineTimezone),
    eventDate
  });
  return parserResult(source, [call], [
    agendaSignal(source, "track", "Applied Human Factors and Ergonomics"),
    agendaSignal(source, "submission-stage", "Abstract submission")
  ], markers);
}
