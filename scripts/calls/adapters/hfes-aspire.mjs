import { agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, firstParagraph, parserResult, plainText } from "./shared.mjs";

export function parseHfesAspire(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["meeting", /ASPIRE|International Annual Meeting/i],
    ["hfes", /HFES|Human Factors and Ergonomics Society/i],
    ["submission", /Call for (?:Abstracts|Submissions)|Submit by/i]
  ]);
  const description = firstParagraph(html, /human factors|ergonomics|exchange ideas|advancements/i);
  const deadline = dateNear(text, /(?:Submit by|deadline|11:59 p\.m\.)/i, 180);
  if (!deadline) throw new Error("HFES-Seite nennt keine eindeutig datierte Deadline mit Jahr");
  const call = callRecord(source, {
    title: `${source.venue} – Call for Submissions`,
    callType: "conference",
    description,
    deadlineAt: deadlineAt(deadline, source.deadlineTimezone),
    eventDate: dateNear(text, /Meeting dates?|conference dates?/i, 120)
  });
  const formats = ["Lecture", "Poster", "Panel", "Case Study", "Invited Symposium", "Demonstration", "Workshop", "Alternative Format"];
  return parserResult(source, [call], formats.filter((label) => new RegExp(`\\b${label}\\b`, "i").test(text)).map((label) => agendaSignal(source, "format", label)), markers);
}
