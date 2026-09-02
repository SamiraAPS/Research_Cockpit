import type { CallParserResult, OfficialCallSource } from "../types";
import { parseAcmChi } from "./acm-chi";
import { parseAhfe } from "./ahfe";
import { parseElsevierJournal } from "./elsevier-journal";
import { parseSageJournal } from "./sage-journal";

export { ParserContractError } from "./shared";

export function parseOfficialCallSource(source: OfficialCallSource, html: string): CallParserResult {
  if (source.adapter === "acm-chi") return parseAcmChi(source, html);
  if (source.adapter === "ahfe") return parseAhfe(source, html);
  if (source.adapter === "elsevier-journal") return parseElsevierJournal(source, html);
  if (source.adapter === "sage-journal") return parseSageJournal(source, html);
  const exhaustive: never = source.adapter;
  throw new Error(`Unsupported call adapter: ${exhaustive}`);
}
