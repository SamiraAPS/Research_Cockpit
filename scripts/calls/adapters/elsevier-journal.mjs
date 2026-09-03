import {
  agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, elementBlocks, firstHeading, firstLink,
  firstParagraph, parserResult, plainText
} from "./shared.mjs";

export function parseElsevierJournal(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["journal", new RegExp(source.venue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")],
    ["call", /Call(?:s)? for papers/i],
    ["deadline", /Submission deadline/i]
  ]);
  const blocks = elementBlocks(html, ["article", "li"])
    .filter((block) => /Submission deadline/i.test(plainText(block)));
  const calls = blocks.flatMap((block) => {
    const blockText = plainText(block);
    const title = firstHeading(block) || firstLink(block)?.label;
    const link = firstLink(block, (href) => /\/special-issue\/|\/call-for-papers/i.test(href));
    const date = dateNear(blockText, /Submission deadline/i, 220);
    if (!title || !link || !date) return [];
    return [callRecord(source, {
      title,
      callType: "special_issue",
      description: firstParagraph(block) || blockText,
      officialUrl: link.href,
      deadlineAt: deadlineAt(date, source.deadlineTimezone),
      eventDate: dateNear(blockText, /publication date|special issue publication/i, 150)
    })];
  });
  if (!calls.length) throw new Error("Elsevier-Parser fand trotz gültiger Marker keinen vollständig belegten Call");
  return parserResult(source, calls, calls.map((call) => agendaSignal(source, "special-issue", call.title)), markers);
}
