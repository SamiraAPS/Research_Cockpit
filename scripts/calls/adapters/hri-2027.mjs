import { agendaSignal, assertMarkers, callRecord, dateNear, deadlineAt, firstParagraph, parserResult, plainText } from "./shared.mjs";

export function parseHri2027(source, html) {
  const text = plainText(html);
  const markers = assertMarkers(source, text, [
    ["conference", /HRI 2027|Human.Robot Interaction/i],
    ["full-papers", /Full Papers/i],
    ["short-contributions", /Short Contributions/i],
    ["deadlines", /Submission Deadline/i]
  ]);
  const description = firstParagraph(html, /Human.Robot Interaction|HRI research|submissions/i) || text.slice(0, 600);
  const eventDate = dateNear(text, /Conference\s+(?:Mar|March)\s+8/i, 100);
  const deadlinesStart = text.search(/All Deadlines/i);
  const deadlines = text.slice(deadlinesStart < 0 ? 0 : deadlinesStart);
  const definitions = [
    ["Full Papers", "papers", /Full Papers/i, /Abstract Submission Deadline/i],
    ["Short Contributions", "papers", /Short Contributions/i, /Submission Deadline/i],
    ["alt.HRI", "papers", /alt\.HRI/i, /Submission deadline/i],
    ["Workshops & Tutorials", "workshop", /Workshops\s*(?:&|and)\s*Tutorials/i, /Submission of Proposals/i],
    ["Videos and Demos", "conference", /Videos and Demos/i, /Submission deadline/i],
    ["Industry White Papers", "papers", /Industry White Papers/i, /Submission deadline/i],
    ["Student Design Competition", "conference", /Student Design Competition/i, /Submission deadline/i],
    ["HRI Pioneers", "conference", /HRI Pioneers/i, /Submission deadline/i]
  ];
  const calls = definitions.flatMap(([label, callType, pattern, deadlinePattern]) => {
    const trackStart = deadlines.search(pattern);
    const trackText = trackStart < 0 ? "" : deadlines.slice(trackStart, trackStart + 260);
    const date = dateNear(trackText, deadlinePattern, 100);
    return date ? [callRecord(source, {
      title: `${source.venue} – ${label}`,
      callType,
      description,
      deadlineAt: deadlineAt(date, source.deadlineTimezone),
      eventDate
    })] : [];
  });
  if (!calls.length) throw new Error("HRI-Parser fand trotz gültiger Marker keine Submission-Deadline");
  return parserResult(source, calls, definitions.map(([label]) => agendaSignal(source, "track", label)), markers);
}
