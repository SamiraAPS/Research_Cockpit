import {
  agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, elementBlocks, firstHeading, firstLink,
  firstParagraph, parserResult, plainText
} from "./shared.mjs";

export function parseSageHumanRelations(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["journal", /Human Relations/i],
    ["call", /Call(?:s)? for papers/i],
    ["deadline", /deadline|proposals? by|submissions?.*due/i]
  ]);
  const blocks = elementBlocks(html, ["article", "li"])
    .filter((block) => /deadline|proposals? by|submissions?.*due/i.test(plainText(block)));
  const calls = blocks.flatMap((block) => {
    const blockText = plainText(block);
    const title = firstHeading(block) || firstLink(block)?.label;
    const link = firstLink(block, (href) => /\/doi\/|\/call-for-papers\//i.test(href));
    const date = dateNear(blockText, /deadline|proposals? by|submissions?.*due/i, 260);
    if (!title || !link || !date) return [];
    return [callRecord(source, {
      title,
      callType: /proposal/i.test(title) ? "special_issue_proposal" : "special_issue",
      description: firstParagraph(block) || blockText,
      officialUrl: link.href,
      deadlineAt: deadlineAt(date, source.deadlineTimezone),
      eventDate: dateNear(blockText, /publication date|issue published/i, 150)
    })];
  });
  if (!calls.length) throw new Error("SAGE-Parser fand trotz gültiger Marker keinen vollständig belegten Call");
  return parserResult(source, calls, calls.map((call) => agendaSignal(source, "special-issue", call.title)), markers);
}
