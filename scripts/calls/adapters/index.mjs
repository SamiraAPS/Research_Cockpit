import { parseAhfe2027 } from "./ahfe-2027.mjs";
import { parseChi2027 } from "./chi-2027.mjs";
import { parseCscwRolling } from "./cscw-rolling.mjs";
import { parseDis2027 } from "./dis-2027.mjs";
import { parseElsevierJournal } from "./elsevier-journal.mjs";
import { parseHfesAspire } from "./hfes-aspire.mjs";
import { parseHri2027 } from "./hri-2027.mjs";
import { parseIui2027 } from "./iui-2027.mjs";
import { parseSageHumanRelations } from "./sage-human-relations.mjs";

export { ParserContractError } from "./shared.mjs";

const ADAPTERS = new Map([
  ["chi-2027", parseChi2027],
  ["cscw-rolling", parseCscwRolling],
  ["iui-2027", parseIui2027],
  ["hri-2027", parseHri2027],
  ["dis-2027", parseDis2027],
  ["hfes-aspire", parseHfesAspire],
  ["ahfe-2027", parseAhfe2027],
  ["sage-human-relations", parseSageHumanRelations],
  ["elsevier-journal", parseElsevierJournal]
]);

export function parseOfficialCallSource(source, html) {
  const adapter = ADAPTERS.get(source.adapter);
  if (!adapter) throw new Error(`Kein quellenspezifischer Adapter für ${source.key}`);
  return adapter(source, html);
}
