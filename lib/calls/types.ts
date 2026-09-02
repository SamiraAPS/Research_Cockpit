export type CallType = "papers" | "special_issue" | "conference" | "workshop";
export type CallStatus = "open" | "closing" | "expired" | "unverified";
export type CallSourceStateStatus = "verified" | "changed" | "parser_error" | "unavailable";
export type CallAdapterId = "acm-chi" | "ahfe" | "elsevier-journal" | "sage-journal";

export type OfficialCallSource = {
  key: string;
  name: string;
  organization: string;
  kind: "organization" | "publisher";
  url: string;
  adapter: CallAdapterId;
  sourceVersion: string;
  parserVersion: string;
  allowedHosts: readonly string[];
};

export type ParsedCall = {
  sourceRecordId: string;
  title: string;
  callType: CallType;
  organizer: string;
  description: string;
  officialUrl: string;
  submissionDeadline: string | null;
  eventOrPublicationDate: string | null;
  themes: string[];
};

export type CallParserResult = {
  calls: ParsedCall[];
  structureMarkers: string[];
};
