export const SOURCE_CONFIG_VERSION = "sources-3.0.0";

export type ConfiguredSource = {
  id: string;
  name: string;
  area: string;
};

export const CORE_JOURNALS: readonly ConfiguredSource[] = [
  { id: "S94432539", name: "Applied Ergonomics", area: "Human factors & ergonomics" },
  { id: "S72159247", name: "Ergonomics", area: "Human factors & ergonomics" },
  { id: "S83386566", name: "Human Factors", area: "Human factors & ergonomics" },
  { id: "S92539022", name: "International Journal of Industrial Ergonomics", area: "Human factors & ergonomics" },
  { id: "S113222589", name: "Cognition, Technology & Work", area: "Cognitive systems" },
  { id: "S153474389", name: "Journal of Cognitive Engineering and Decision Making", area: "Cognitive systems" },
  { id: "S4210190811", name: "International Journal of Human-Computer Studies", area: "Human–computer interaction" },
  { id: "S165559636", name: "International Journal of Human-Computer Interaction", area: "Human–computer interaction" },
  { id: "S2476799526", name: "IEEE Transactions on Human-Machine Systems", area: "Human–machine systems" },
  { id: "S204030396", name: "Computers in Human Behavior", area: "Psychology & technology" },
  { id: "S175747132", name: "New Technology, Work and Employment", area: "Work design" },
  { id: "S141527467", name: "Work & Stress", area: "Work psychology" },
  { id: "S3481703", name: "Journal of Occupational Health Psychology", area: "Work psychology" },
  { id: "S166002381", name: "Journal of Applied Psychology", area: "Applied psychology" },
  { id: "S4210190517", name: "AI & Society", area: "AI & society" },
  { id: "S123149298", name: "Safety Science", area: "Safety & resilience" },
  { id: "S64744539", name: "Organizational Behavior and Human Decision Processes", area: "Organizational psychology" },
  { id: "S206124708", name: "Organization Science", area: "Organization & management" },
  { id: "S28882882", name: "Organization Studies", area: "Organization & management" },
  { id: "S61446109", name: "Human Relations", area: "Organization & work" },
  { id: "S57293258", name: "MIS Quarterly", area: "Information systems" },
  { id: "S202812398", name: "Information Systems Research", area: "Information systems" },
  { id: "S9954729", name: "Journal of Management Information Systems", area: "Information systems" },
];

export const CORE_CONFERENCES: readonly ConfiguredSource[] = [
  { id: "S4363607743", name: "CHI Conference on Human Factors in Computing Systems", area: "Human–computer interaction" },
  { id: "S4210183893", name: "Proceedings of the ACM on Human-Computer Interaction (CSCW/PACMHCI)", area: "Computer-supported cooperative work" },
  { id: "S4306418948", name: "Intelligent User Interfaces (IUI)", area: "Intelligent interfaces" },
  { id: "S4306418552", name: "Human-Robot Interaction (HRI)", area: "Human–robot interaction" },
  { id: "S4363608268", name: "Designing Interactive Systems Conference (DIS)", area: "Interaction design" },
  { id: "S4210176815", name: "Human Factors and Ergonomics Society Annual Meeting (HFES)", area: "Human factors & ergonomics" },
];

export const FRONTIER_REPOSITORIES: readonly ConfiguredSource[] = [
  { id: "S4306400194", name: "arXiv", area: "Multidisciplinary preprints" },
  { id: "S4306401687", name: "PsyArXiv", area: "Psychology preprints" },
  { id: "S3005725775", name: "PsyArXiv", area: "Psychology preprints" },
  { id: "S4306401238", name: "SocArXiv", area: "Social science preprints" },
  { id: "S3006283864", name: "SocArXiv", area: "Social science preprints" },
  { id: "S4306401127", name: "OSF Preprints", area: "Multidisciplinary preprints" },
  { id: "S4210172589", name: "SSRN", area: "Social science working papers" },
  { id: "S4306525896", name: "Research Square", area: "Multidisciplinary preprints" },
  { id: "S4306525895", name: "Research Square", area: "Multidisciplinary preprints" },
  { id: "S6309402219", name: "Preprints.org", area: "Multidisciplinary preprints" },
];

export const FRONTIER_PROCEEDINGS: readonly ConfiguredSource[] = [
  ...CORE_CONFERENCES,
  { id: "S4363607762", name: "CHI Conference Extended Abstracts", area: "Early HCI signals" },
];

export const JOURNALS = CORE_JOURNALS;
export const PREPRINT_SOURCES = FRONTIER_REPOSITORIES.map(({ id, name }) => ({ id, name }));

