import { agendaSignal, assertMarkers, callRecord, firstParagraph, parserResult, plainText } from "./shared.mjs";

export function parseCscwRolling(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["cscw", /CSCW/i],
    ["call-for-papers", /Call for Papers/i],
    ["rolling-policy", /no submission deadlines|rolling/i],
    ["journal-route", /PACM\s*HCI|ToCHI/i]
  ]);
  const callStart = text.search(/Call for Papers for CSCW/i);
  const description = firstParagraph(html, /present a paper|accepted at one of two journals|no submission deadlines/i)
    || text.slice(Math.max(0, callStart), Math.max(0, callStart) + 600);
  const call = callRecord(source, {
    title: "ACM CSCW / PACMHCI Rolling Call for Papers",
    callType: "papers",
    description,
    deadlineAt: null,
    eventDate: null,
    topics: ["HCI", "collaboration"]
  });
  return parserResult(source, [call], [
    agendaSignal(source, "publication-route", "PACM HCI/CSCW"),
    agendaSignal(source, "publication-route", "ToCHI"),
    agendaSignal(source, "deadline-policy", "Rolling submissions without an annual deadline")
  ], markers);
}
