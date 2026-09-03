import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_FILES = [
  "meta.json",
  "search-index.json",
  "calls.json",
  "agenda-signals.json",
  "trends.json",
  "questions.json",
  "source-health.json",
  "snapshots/index.json",
];

const DATASET_STATUSES = new Set(["ready", "partial", "unavailable"]);
const SOURCE_STATUSES = new Set(["not_checked", "healthy", "degraded", "stale", "unavailable"]);
const META_STATUSES = new Set(["empty", "partial", "ready"]);
const MODES = new Set(["empty", "snapshot", "incremental"]);
const CALL_STATUSES = new Set(["open", "closing-soon", "expired", "unverified"]);
const CALL_SOURCE_STATUSES = new Set(["not_checked", "verified", "changed", "forbidden", "parser_error", "unavailable", "stale"]);
const CALL_TYPES = new Set(["papers", "special_issue", "special_issue_proposal", "conference", "workshop"]);
const AGENDA_SIGNAL_KINDS = new Set(["track", "format", "publication-route", "deadline-policy", "submission-stage", "special-issue"]);
const PUBLICATION_TREND_STATUSES = new Set(["growing", "stable", "declining", "mixed", "insufficient"]);
const EMERGING_STATUSES = new Set(["emerging", "rising", "stable", "cooling", "insufficient"]);
const AGENDA_STATUSES = new Set(["strong", "moderate", "weak", "unavailable"]);
const OPPORTUNITY_STATUSES = new Set(["possible", "mixed", "low", "insufficient"]);
const QUESTION_STATUSES = new Set(["framework", "supported", "insufficient"]);
const VERSION_PATTERN = /^[a-z][a-z0-9-]*-\d+\.\d+\.\d+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const SECRET_KEY_PATTERN = /(?:api.?key|token|password|passwd|secret|private.?key|authorization|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/]+:[^\s@/]+@/i,
];

async function findJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJsonFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}

function isValidTimestamp(value) {
  return typeof value === "string"
    && TIMESTAMP_PATTERN.test(value)
    && isValidDate(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value));
}

function normalizeDoi(value) {
  return value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
}

function joinPointer(base, key) {
  const escaped = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${base}/${escaped}`;
}

function makeContext(errors, file) {
  return {
    error(code, pointer, message) {
      errors.push({ code, file, path: pointer || "/", message });
    },
  };
}

function requireObject(ctx, value, pointer) {
  if (isObject(value)) return true;
  ctx.error("invalid-type", pointer, "muss ein Objekt sein");
  return false;
}

function requireFields(ctx, value, fields, pointer = "") {
  if (!requireObject(ctx, value, pointer)) return false;
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) ctx.error("required-field", joinPointer(pointer, field), "erforderliches Feld fehlt");
  }
  return true;
}

function expectArray(ctx, value, pointer) {
  if (Array.isArray(value)) return true;
  ctx.error("invalid-type", pointer, "muss ein Array sein");
  return false;
}

function expectString(ctx, value, pointer, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  if (typeof value === "string" && value.length > 0) return true;
  ctx.error("invalid-type", pointer, nullable ? "muss eine nichtleere Zeichenfolge oder null sein" : "muss eine nichtleere Zeichenfolge sein");
  return false;
}

function expectInteger(ctx, value, pointer, minimum = 0) {
  if (Number.isInteger(value) && value >= minimum) return true;
  ctx.error("invalid-number", pointer, `muss eine ganze Zahl >= ${minimum} sein`);
  return false;
}

function expectNumber(ctx, value, pointer, minimum = Number.NEGATIVE_INFINITY) {
  if (typeof value === "number" && Number.isFinite(value) && value >= minimum) return true;
  ctx.error("invalid-number", pointer, `muss eine endliche Zahl >= ${minimum} sein`);
  return false;
}

function expectNullableNumber(ctx, value, pointer, minimum = Number.NEGATIVE_INFINITY) {
  if (value === null) return true;
  return expectNumber(ctx, value, pointer, minimum);
}

function expectHash(ctx, value, pointer) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    ctx.error("invalid-hash", pointer, "muss ein SHA-256-Hash sein");
    return false;
  }
  return true;
}

function expectStringArray(ctx, value, pointer) {
  if (!expectArray(ctx, value, pointer)) return false;
  value.forEach((entry, index) => expectString(ctx, entry, `${pointer}/${index}`));
  return true;
}

function expectEnum(ctx, value, allowed, pointer) {
  if (allowed.has(value)) return true;
  ctx.error("invalid-status", pointer, `ungültiger Wert ${JSON.stringify(value)}; erlaubt: ${[...allowed].join(", ")}`);
  return false;
}

function validateVersion(ctx, value, pointer) {
  if (!expectString(ctx, value, pointer)) return;
  if (!VERSION_PATTERN.test(value)) ctx.error("invalid-version", pointer, "muss eine versionierte Kennung wie name-1.0.0 sein");
}

function validateDatesRecursively(ctx, value, pointer = "") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateDatesRecursively(ctx, entry, joinPointer(pointer, index)));
    return;
  }
  if (!isObject(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    const entryPointer = joinPointer(pointer, key);
    if (entry !== null && (key.endsWith("At") || key === "generatedAt")) {
      if (!isValidTimestamp(entry)) ctx.error("invalid-date", entryPointer, "muss ein gültiger RFC-3339-Zeitstempel mit Zeitzone sein");
    } else if (entry !== null && key.endsWith("Date")) {
      if (!isValidDate(entry)) ctx.error("invalid-date", entryPointer, "muss ein gültiges Kalenderdatum im Format YYYY-MM-DD sein");
    }
    validateDatesRecursively(ctx, entry, entryPointer);
  }
}

function validateSecurityRecursively(ctx, value, pointer = "") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSecurityRecursively(ctx, entry, joinPointer(pointer, index)));
    return;
  }
  if (!isObject(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    const entryPointer = joinPointer(pointer, key);
    if (SECRET_KEY_PATTERN.test(key) && entry !== null && entry !== "") {
      ctx.error("secret-detected", entryPointer, "potenzielles Zugangsdatenfeld darf nicht veröffentlicht werden");
    }
    if (/^(?:synthetic|isSynthetic|fallback|isFallback|fixture|testOnly)$/i.test(key) && Boolean(entry)) {
      ctx.error("synthetic-fallback", entryPointer, "synthetische oder Test-Fallbacks sind in Produktionsdaten unzulässig");
    }
    if (typeof entry === "string") {
      if (/^(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/))/i.test(entry)) {
        ctx.error("absolute-path", entryPointer, "absoluter lokaler Pfad darf nicht veröffentlicht werden");
      }
      if (entry.includes("tests/fixtures/") || entry.includes("tests\\fixtures\\")) {
        ctx.error("fixture-reference", entryPointer, "Produktionsdaten dürfen nicht auf Test-Fixtures verweisen");
      }
      if (/^(?:synthetic|fixture|fallback)$/i.test(entry) && /(?:source|provider|origin|kind|mode)$/i.test(key)) {
        ctx.error("synthetic-fallback", entryPointer, "synthetische Quelle oder Fallback ist unzulässig");
      }
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(entry))) {
        ctx.error("secret-detected", entryPointer, "Wert sieht wie ein Secret oder eine Zugangsdaten-URL aus");
      }
    }
    validateSecurityRecursively(ctx, entry, entryPointer);
  }
}

function validateMeta(ctx, data) {
  if (!requireFields(ctx, data, [
    "schemaVersion", "generatedAt", "lastSuccessfulIngestionAt", "analysisVersion", "queryVersion",
    "ontologyVersion", "mode", "status", "totalFound", "totalAnalyzed", "message", "sourceStatus",
    "dataQualityWarnings", "datasets",
  ])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectString(ctx, data.analysisVersion, "/analysisVersion");
  expectString(ctx, data.queryVersion, "/queryVersion");
  expectString(ctx, data.ontologyVersion, "/ontologyVersion");
  expectString(ctx, data.message, "/message");
  expectEnum(ctx, data.mode, MODES, "/mode");
  expectEnum(ctx, data.status, META_STATUSES, "/status");
  expectInteger(ctx, data.totalFound, "/totalFound");
  expectInteger(ctx, data.totalAnalyzed, "/totalAnalyzed");
  if (Object.hasOwn(data, "methodVersions") && requireObject(ctx, data.methodVersions, "/methodVersions")) {
    for (const field of ["analysis", "ontology", "classification", "trends", "questions", "opportunities", "snapshots"]) {
      if (!Object.hasOwn(data.methodVersions, field)) ctx.error("required-field", `/methodVersions/${field}`, "erforderliche Methodenversion fehlt");
      else validateVersion(ctx, data.methodVersions[field], `/methodVersions/${field}`);
    }
  }
  if (Number.isInteger(data.totalFound) && Number.isInteger(data.totalAnalyzed) && data.totalAnalyzed > data.totalFound) {
    ctx.error("inconsistent-total", "/totalAnalyzed", "darf totalFound nicht überschreiten");
  }
  if (expectArray(ctx, data.sourceStatus, "/sourceStatus")) {
    data.sourceStatus.forEach((source, index) => {
      const pointer = `/sourceStatus/${index}`;
      if (!requireFields(ctx, source, ["source", "status", "recordCount", "checkedAt", "message"], pointer)) return;
      expectString(ctx, source.source, `${pointer}/source`);
      expectEnum(ctx, source.status, SOURCE_STATUSES, `${pointer}/status`);
      expectInteger(ctx, source.recordCount, `${pointer}/recordCount`);
    });
  }
  if (expectArray(ctx, data.dataQualityWarnings, "/dataQualityWarnings")) {
    data.dataQualityWarnings.forEach((warning, index) => {
      const pointer = `/dataQualityWarnings/${index}`;
      if (!requireFields(ctx, warning, ["code", "severity", "message", "affectedRecords"], pointer)) return;
      expectString(ctx, warning.code, `${pointer}/code`);
      expectEnum(ctx, warning.severity, new Set(["info", "warning", "error"]), `${pointer}/severity`);
      expectString(ctx, warning.message, `${pointer}/message`);
      expectInteger(ctx, warning.affectedRecords, `${pointer}/affectedRecords`);
    });
  }
  if (requireObject(ctx, data.datasets, "/datasets")) {
    const datasetNames = ["publications", "preprints", "searchIndex", "calls", "trends", "questions", "sourceHealth", "snapshots"];
    for (const name of datasetNames) {
      const pointer = `/datasets/${name}`;
      if (!Object.hasOwn(data.datasets, name)) {
        ctx.error("required-field", pointer, "erforderlicher Dataset-Eintrag fehlt");
        continue;
      }
      const dataset = data.datasets[name];
      if (!requireFields(ctx, dataset, ["path", "status", "recordCount"], pointer)) continue;
      expectString(ctx, dataset.path, `${pointer}/path`);
      if (typeof dataset.path === "string" && (!dataset.path.startsWith("./") || dataset.path.includes("..") || dataset.path.includes("\\"))) {
        ctx.error("invalid-relative-path", `${pointer}/path`, "muss ein sicherer relativer POSIX-Pfad mit ./ sein");
      }
      expectEnum(ctx, dataset.status, DATASET_STATUSES, `${pointer}/status`);
      expectInteger(ctx, dataset.recordCount, `${pointer}/recordCount`);
    }
  }
}

function validateWork(ctx, work, pointer) {
  const required = [
    "id", "recordType", "title", "abstract", "doi", "externalIds", "source", "venue",
    "publicationDate", "topics", "keywords", "classifiedThemes", "scores", "evidenceTerms",
    "authors", "url", "retrievedAt",
  ];
  if (!requireFields(ctx, work, required, pointer)) return;
  expectString(ctx, work.id, `${pointer}/id`);
  expectEnum(ctx, work.recordType, new Set(["publication", "preprint"]), `${pointer}/recordType`);
  expectString(ctx, work.title, `${pointer}/title`);
  expectString(ctx, work.abstract, `${pointer}/abstract`, { nullable: true });
  if (work.doi !== null && (!expectString(ctx, work.doi, `${pointer}/doi`) || !DOI_PATTERN.test(work.doi))) {
    ctx.error("invalid-doi", `${pointer}/doi`, "muss eine kanonische DOI ohne https://doi.org/ sein");
  }
  if (requireObject(ctx, work.externalIds, `${pointer}/externalIds`)) {
    for (const [key, value] of Object.entries(work.externalIds)) expectString(ctx, value, `${pointer}/externalIds/${key}`);
  }
  if (requireFields(ctx, work.source, ["name", "recordId"], `${pointer}/source`)) {
    expectString(ctx, work.source.name, `${pointer}/source/name`);
    expectString(ctx, work.source.recordId, `${pointer}/source/recordId`);
  }
  expectString(ctx, work.venue, `${pointer}/venue`, { nullable: true });
  for (const field of ["topics", "keywords", "evidenceTerms"]) expectStringArray(ctx, work[field], `${pointer}/${field}`);
  expectArray(ctx, work.classifiedThemes, `${pointer}/classifiedThemes`);
  if (requireObject(ctx, work.scores, `${pointer}/scores`)) {
    for (const [key, value] of Object.entries(work.scores)) expectNumber(ctx, value, `${pointer}/scores/${key}`);
  }
  if (Array.isArray(work.classifiedThemes)) {
    work.classifiedThemes.forEach((theme, index) => {
      const themePointer = `${pointer}/classifiedThemes/${index}`;
      if (!requireFields(ctx, theme, ["theme", "label", "score", "classificationVersion", "ontologyVersion", "evidence"], themePointer)) return;
      expectString(ctx, theme.theme, `${themePointer}/theme`);
      expectString(ctx, theme.label, `${themePointer}/label`);
      expectNumber(ctx, theme.score, `${themePointer}/score`, 0);
      expectString(ctx, theme.classificationVersion, `${themePointer}/classificationVersion`);
      expectString(ctx, theme.ontologyVersion, `${themePointer}/ontologyVersion`);
      if (expectArray(ctx, theme.evidence, `${themePointer}/evidence`)) {
        theme.evidence.forEach((evidence, evidenceIndex) => {
          const evidencePointer = `${themePointer}/evidence/${evidenceIndex}`;
          if (!requireFields(ctx, evidence, ["source", "concept", "matchedTerm", "weight"], evidencePointer)) return;
          expectEnum(ctx, evidence.source, new Set(["title", "abstract", "keyword", "external_topic"]), `${evidencePointer}/source`);
          expectString(ctx, evidence.concept, `${evidencePointer}/concept`);
          expectString(ctx, evidence.matchedTerm, `${evidencePointer}/matchedTerm`);
          expectNumber(ctx, evidence.weight, `${evidencePointer}/weight`, 0);
        });
      }
    });
  }
  if (expectArray(ctx, work.authors, `${pointer}/authors`)) {
    work.authors.forEach((author, index) => {
      const authorPointer = `${pointer}/authors/${index}`;
      if (!requireFields(ctx, author, ["name"], authorPointer)) return;
      expectString(ctx, author.name, `${authorPointer}/name`);
      if (Object.hasOwn(author, "affiliations")) expectStringArray(ctx, author.affiliations, `${authorPointer}/affiliations`);
    });
  }
  if (Object.hasOwn(work, "dataStatus")) expectEnum(ctx, work.dataStatus, new Set(["current", "stale"]), `${pointer}/dataStatus`);
  if (Object.hasOwn(work, "versions") && expectArray(ctx, work.versions, `${pointer}/versions`)) {
    const versionIds = new Set();
    work.versions.forEach((version, index) => {
      const versionPointer = `${pointer}/versions/${index}`;
      if (!requireFields(ctx, version, ["id", "type", "source", "externalId", "doi", "url"], versionPointer)) return;
      expectString(ctx, version.id, `${versionPointer}/id`);
      expectEnum(ctx, version.type, new Set(["journal", "preprint", "proceedings"]), `${versionPointer}/type`);
      expectString(ctx, version.source, `${versionPointer}/source`);
      expectString(ctx, version.externalId, `${versionPointer}/externalId`);
      if (typeof version.id === "string" && versionIds.has(version.id)) ctx.error("duplicate-id", `${versionPointer}/id`, "Versions-ID ist innerhalb des Works doppelt");
      if (typeof version.id === "string") versionIds.add(version.id);
    });
    if (Object.hasOwn(work, "preferredVersionId") && !work.versions.some((version) => version.id === work.preferredVersionId)) {
      ctx.error("unknown-version-id", `${pointer}/preferredVersionId`, "verweist auf keine Version dieses Works");
    }
  }
  if (Object.hasOwn(work, "discoveredBy") && expectArray(ctx, work.discoveredBy, `${pointer}/discoveredBy`)) {
    work.discoveredBy.forEach((discovery, index) => {
      const discoveryPointer = `${pointer}/discoveredBy/${index}`;
      if (!requireFields(ctx, discovery, ["provider", "mode", "queryVersion"], discoveryPointer)) return;
      expectEnum(ctx, discovery.provider, new Set(["openalex", "arxiv"]), `${discoveryPointer}/provider`);
      expectEnum(ctx, discovery.mode, new Set(["core", "broad", "frontier"]), `${discoveryPointer}/mode`);
      expectString(ctx, discovery.queryVersion, `${discoveryPointer}/queryVersion`);
    });
  }
}

function validateWorksPage(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "page", "pageSize", "totalItems", "totalPages", "nextPage", "items"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectInteger(ctx, data.page, "/page", 1);
  expectInteger(ctx, data.pageSize, "/pageSize", 1);
  expectInteger(ctx, data.totalItems, "/totalItems");
  expectInteger(ctx, data.totalPages, "/totalPages");
  if (data.nextPage !== null && (!expectString(ctx, data.nextPage, "/nextPage") || !/^\.\/page-\d+\.json$/.test(data.nextPage))) {
    ctx.error("invalid-relative-path", "/nextPage", "muss null oder ein relativer Works-Seitenpfad sein");
  }
  if (expectArray(ctx, data.items, "/items")) {
    if (Number.isInteger(data.pageSize) && data.items.length > data.pageSize) ctx.error("page-overflow", "/items", "enthält mehr Einträge als pageSize");
    data.items.forEach((work, index) => validateWork(ctx, work, `/items/${index}`));
  }
}

function validateSearchIndex(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "queryVersion", "ontologyVersion", "documents"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectString(ctx, data.queryVersion, "/queryVersion");
  expectString(ctx, data.ontologyVersion, "/ontologyVersion");
  if (!expectArray(ctx, data.documents, "/documents")) return;
  data.documents.forEach((document, index) => {
    const pointer = `/documents/${index}`;
    if (!requireFields(ctx, document, ["id", "recordType", "title", "abstract", "authors", "venue", "publicationDate", "topics", "keywords", "themes", "evidenceTerms", "url"], pointer)) return;
    expectString(ctx, document.id, `${pointer}/id`);
    expectEnum(ctx, document.recordType, new Set(["publication", "preprint"]), `${pointer}/recordType`);
    expectString(ctx, document.title, `${pointer}/title`);
    expectString(ctx, document.abstract, `${pointer}/abstract`, { nullable: true });
    expectString(ctx, document.venue, `${pointer}/venue`, { nullable: true });
    for (const field of ["authors", "topics", "keywords", "themes", "evidenceTerms"]) expectStringArray(ctx, document[field], `${pointer}/${field}`);
  });
}

function validateCalls(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "status", "registryVersion", "closingWindowDays", "counts", "sourceStatus", "items"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectEnum(ctx, data.status, DATASET_STATUSES, "/status");
  expectString(ctx, data.registryVersion, "/registryVersion");
  expectInteger(ctx, data.closingWindowDays, "/closingWindowDays", 1);
  if (requireFields(ctx, data.counts, ["totalStored", "active", "open", "closingSoon", "expired", "unverified"], "/counts")) {
    for (const field of ["totalStored", "active", "open", "closingSoon", "expired", "unverified"]) {
      expectInteger(ctx, data.counts[field], `/counts/${field}`);
    }
  }
  if (expectArray(ctx, data.sourceStatus, "/sourceStatus")) data.sourceStatus.forEach((source, index) => {
    const pointer = `/sourceStatus/${index}`;
    if (!requireFields(ctx, source, [
      "sourceKey", "sourceName", "officialUrl", "status", "checkedAt", "lastVerifiedAt", "httpStatus",
      "foundCount", "agendaSignalCount", "attempts", "latencyMs", "rateLimitEvents", "message",
      "parserVersion", "sourceVersion", "sourceContentHash",
    ], pointer)) return;
    expectString(ctx, source.sourceKey, `${pointer}/sourceKey`);
    expectString(ctx, source.sourceName, `${pointer}/sourceName`);
    expectString(ctx, source.officialUrl, `${pointer}/officialUrl`);
    if (typeof source.officialUrl === "string" && !source.officialUrl.startsWith("https://")) ctx.error("invalid-url", `${pointer}/officialUrl`, "muss eine offizielle HTTPS-URL sein");
    expectEnum(ctx, source.status, CALL_SOURCE_STATUSES, `${pointer}/status`);
    for (const field of ["foundCount", "agendaSignalCount", "attempts", "latencyMs", "rateLimitEvents"]) expectInteger(ctx, source[field], `${pointer}/${field}`);
    for (const field of ["parserVersion", "sourceVersion"]) expectString(ctx, source[field], `${pointer}/${field}`);
    if (source.sourceContentHash !== null && (typeof source.sourceContentHash !== "string" || !/^[a-f0-9]{64}$/.test(source.sourceContentHash))) {
      ctx.error("invalid-hash", `${pointer}/sourceContentHash`, "muss ein SHA-256-Hash oder null sein");
    }
  });
  if (!expectArray(ctx, data.items, "/items")) return;
  data.items.forEach((call, index) => {
    const pointer = `/items/${index}`;
    if (!requireFields(ctx, call, [
      "id", "sourceRecordId", "title", "venue", "callType", "organizer", "description", "officialUrl",
      "opensAt", "deadlineAt", "deadlineTimezone", "eventDate", "topics", "status", "createdAt",
      "lastCheckedAt", "lastVerifiedAt", "parserVersion", "sourceVersion", "sourceKey", "sourceKeys",
      "sourceName", "contentHash", "versions",
    ], pointer)) return;
    expectString(ctx, call.id, `${pointer}/id`);
    expectString(ctx, call.sourceRecordId, `${pointer}/sourceRecordId`);
    expectString(ctx, call.title, `${pointer}/title`);
    expectString(ctx, call.venue, `${pointer}/venue`);
    expectString(ctx, call.organizer, `${pointer}/organizer`);
    expectString(ctx, call.description, `${pointer}/description`);
    expectString(ctx, call.officialUrl, `${pointer}/officialUrl`);
    if (typeof call.officialUrl === "string" && !call.officialUrl.startsWith("https://")) ctx.error("invalid-url", `${pointer}/officialUrl`, "muss eine offizielle HTTPS-URL sein");
    expectEnum(ctx, call.status, CALL_STATUSES, `${pointer}/status`);
    expectEnum(ctx, call.callType, CALL_TYPES, `${pointer}/callType`);
    expectStringArray(ctx, call.topics, `${pointer}/topics`);
    expectStringArray(ctx, call.sourceKeys, `${pointer}/sourceKeys`);
    for (const field of ["deadlineTimezone", "parserVersion", "sourceVersion", "sourceKey", "sourceName"]) expectString(ctx, call[field], `${pointer}/${field}`);
    if (typeof call.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(call.contentHash)) ctx.error("invalid-hash", `${pointer}/contentHash`, "muss ein SHA-256-Hash sein");
    if (expectArray(ctx, call.versions, `${pointer}/versions`)) {
      if (call.versions.length === 0) ctx.error("required-version", `${pointer}/versions`, "muss mindestens eine Version enthalten");
      call.versions.forEach((version, versionIndex) => {
        const versionPointer = `${pointer}/versions/${versionIndex}`;
        if (!requireFields(ctx, version, ["version", "contentHash", "observedAt", "title", "description", "officialUrl", "deadlineAt", "eventDate", "topics"], versionPointer)) return;
        expectInteger(ctx, version.version, `${versionPointer}/version`, 1);
        if (version.version !== versionIndex + 1) ctx.error("invalid-version-order", `${versionPointer}/version`, "Versionsnummern müssen lückenlos ab 1 steigen");
        expectString(ctx, version.title, `${versionPointer}/title`);
        expectString(ctx, version.description, `${versionPointer}/description`);
        expectString(ctx, version.officialUrl, `${versionPointer}/officialUrl`);
        expectStringArray(ctx, version.topics, `${versionPointer}/topics`);
      });
      if (call.versions.at(-1)?.contentHash !== call.contentHash) ctx.error("version-hash-mismatch", `${pointer}/contentHash`, "muss der jüngsten Version entsprechen");
    }
  });
  if (Number.isInteger(data.counts?.totalStored) && data.counts.totalStored !== data.items.length) ctx.error("inconsistent-total", "/counts/totalStored", "stimmt nicht mit items überein");
  if (Number.isInteger(data.counts?.active) && data.counts.active !== data.items.filter((call) => ["open", "closing-soon"].includes(call.status)).length) ctx.error("inconsistent-total", "/counts/active", "stimmt nicht mit aktiven Calls überein");
}

function validateAgendaSignals(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "status", "registryVersion", "interpretation", "items"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectEnum(ctx, data.status, DATASET_STATUSES, "/status");
  expectString(ctx, data.registryVersion, "/registryVersion");
  expectString(ctx, data.interpretation, "/interpretation");
  if (!expectArray(ctx, data.items, "/items")) return;
  data.items.forEach((entry, index) => {
    const pointer = `/items/${index}`;
    if (!requireFields(ctx, entry, ["sourceKey", "sourceName", "officialUrl", "capturedAt", "parserVersion", "sourceVersion", "sourceContentHash", "dataStatus", "signals"], pointer)) return;
    for (const field of ["sourceKey", "sourceName", "officialUrl", "parserVersion", "sourceVersion", "sourceContentHash"]) expectString(ctx, entry[field], `${pointer}/${field}`);
    expectEnum(ctx, entry.dataStatus, new Set(["verified", "stale"]), `${pointer}/dataStatus`);
    if (expectArray(ctx, entry.signals, `${pointer}/signals`)) entry.signals.forEach((signal, signalIndex) => {
      const signalPointer = `${pointer}/signals/${signalIndex}`;
      if (!requireFields(ctx, signal, ["id", "kind", "label", "context"], signalPointer)) return;
      expectString(ctx, signal.id, `${signalPointer}/id`);
      expectEnum(ctx, signal.kind, AGENDA_SIGNAL_KINDS, `${signalPointer}/kind`);
      expectString(ctx, signal.label, `${signalPointer}/label`);
    });
  });
}

function validateTrends(ctx, data) {
  if (!requireFields(ctx, data, [
    "schemaVersion", "generatedAt", "status", "snapshotVersion", "analysisVersion", "classificationVersion",
    "ontologyVersion", "inputHash", "scope", "methodology", "coverage", "publicationTrends",
    "emergingSignals", "agendaSignals", "opportunities", "warnings",
  ])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectEnum(ctx, data.status, DATASET_STATUSES, "/status");
  for (const field of ["snapshotVersion", "analysisVersion", "classificationVersion", "ontologyVersion"]) validateVersion(ctx, data[field], `/${field}`);
  expectHash(ctx, data.inputHash, "/inputHash");
  if (data.scope !== "static-corpus") ctx.error("invalid-status", "/scope", "muss static-corpus sein");
  if (requireFields(ctx, data.methodology, ["trendMethodVersion", "opportunityMethodVersion", "shortWindowYears", "longWindowYears", "minimumTrendRecords", "normalization", "currentYearExcluded", "indexingLagDays", "opportunityRequiresAllComponents"], "/methodology")) {
    validateVersion(ctx, data.methodology.trendMethodVersion, "/methodology/trendMethodVersion");
    validateVersion(ctx, data.methodology.opportunityMethodVersion, "/methodology/opportunityMethodVersion");
    for (const field of ["shortWindowYears", "longWindowYears", "minimumTrendRecords"]) expectInteger(ctx, data.methodology[field], `/methodology/${field}`, 1);
    expectInteger(ctx, data.methodology.indexingLagDays, "/methodology/indexingLagDays");
    if (data.methodology.currentYearExcluded !== true) ctx.error("invalid-method", "/methodology/currentYearExcluded", "laufendes Jahr muss ausgeschlossen sein");
    if (data.methodology.opportunityRequiresAllComponents !== true) ctx.error("invalid-method", "/methodology/opportunityRequiresAllComponents", "Opportunity Score muss alle Komponenten verlangen");
  }
  if (requireFields(ctx, data.coverage, ["currentYear", "latestStableYear", "excludedYears", "corpusStartYear", "corpusEndYear", "totalWorks", "publications", "preprints", "journalCount", "proceedingsCount", "corpusComplete", "callsStatus"], "/coverage")) {
    expectInteger(ctx, data.coverage.currentYear, "/coverage/currentYear", 1900);
    expectInteger(ctx, data.coverage.latestStableYear, "/coverage/latestStableYear", 1900);
    expectArray(ctx, data.coverage.excludedYears, "/coverage/excludedYears");
    for (const field of ["totalWorks", "publications", "preprints", "journalCount", "proceedingsCount"]) expectInteger(ctx, data.coverage[field], `/coverage/${field}`);
    expectEnum(ctx, data.coverage.callsStatus, DATASET_STATUSES, "/coverage/callsStatus");
  }
  if (expectArray(ctx, data.publicationTrends, "/publicationTrends")) data.publicationTrends.forEach((trend, index) => {
    const pointer = `/publicationTrends/${index}`;
    if (!requireFields(ctx, trend, ["theme", "label", "status", "totals", "windows", "growth", "accelerationPercentagePoints", "acceleration", "sourceDiversity", "annual", "recentEvidenceWorkIds", "dataQuality"], pointer)) return;
    expectString(ctx, trend.theme, `${pointer}/theme`);
    expectString(ctx, trend.label, `${pointer}/label`);
    expectEnum(ctx, trend.status, PUBLICATION_TREND_STATUSES, `${pointer}/status`);
    if (requireFields(ctx, trend.totals, ["absoluteCount", "journalCount", "preprintCount", "proceedingsCount", "journalShare", "preprintShare"], `${pointer}/totals`)) {
      for (const field of ["absoluteCount", "journalCount", "preprintCount", "proceedingsCount"]) expectInteger(ctx, trend.totals[field], `${pointer}/totals/${field}`);
      for (const field of ["journalShare", "preprintShare"]) expectNullableNumber(ctx, trend.totals[field], `${pointer}/totals/${field}`, 0);
    }
    for (const windowName of ["shortRecent", "shortPrevious", "shortBaseline", "longRecent", "longPrevious"]) {
      const window = trend.windows?.[windowName];
      const windowPointer = `${pointer}/windows/${windowName}`;
      if (!requireFields(ctx, window, ["startYear", "endYear", "yearCount", "absoluteCount", "eligibleCorpusCount", "normalizedRatePer1000", "journalCount", "preprintCount", "proceedingsCount", "journalShare", "preprintShare"], windowPointer)) continue;
      for (const field of ["startYear", "endYear"]) expectInteger(ctx, window[field], `${windowPointer}/${field}`, 1900);
      for (const field of ["yearCount", "absoluteCount", "eligibleCorpusCount", "journalCount", "preprintCount", "proceedingsCount"]) expectInteger(ctx, window[field], `${windowPointer}/${field}`);
      for (const field of ["normalizedRatePer1000", "journalShare", "preprintShare"]) expectNullableNumber(ctx, window[field], `${windowPointer}/${field}`, 0);
    }
    for (const growthName of ["short", "long"]) {
      const growth = trend.growth?.[growthName];
      if (requireFields(ctx, growth, ["absolutePercent", "normalizedPercent"], `${pointer}/growth/${growthName}`)) {
        expectNullableNumber(ctx, growth.absolutePercent, `${pointer}/growth/${growthName}/absolutePercent`);
        expectNullableNumber(ctx, growth.normalizedPercent, `${pointer}/growth/${growthName}/normalizedPercent`);
      }
    }
    expectNullableNumber(ctx, trend.accelerationPercentagePoints, `${pointer}/accelerationPercentagePoints`);
    expectEnum(ctx, trend.acceleration, new Set(["accelerating", "steady", "slowing", "insufficient"]), `${pointer}/acceleration`);
    expectStringArray(ctx, trend.recentEvidenceWorkIds, `${pointer}/recentEvidenceWorkIds`);
  });
  if (expectArray(ctx, data.emergingSignals, "/emergingSignals")) data.emergingSignals.forEach((signal, index) => {
    const pointer = `/emergingSignals/${index}`;
    if (!requireFields(ctx, signal, ["theme", "label", "status", "shortGrowthPercent", "recentPreprintShare", "recentWorkCount", "evidenceWorkIds", "minimumEvidenceRecords"], pointer)) return;
    expectString(ctx, signal.theme, `${pointer}/theme`);
    expectEnum(ctx, signal.status, EMERGING_STATUSES, `${pointer}/status`);
    expectNullableNumber(ctx, signal.shortGrowthPercent, `${pointer}/shortGrowthPercent`);
    expectNullableNumber(ctx, signal.recentPreprintShare, `${pointer}/recentPreprintShare`, 0);
    expectInteger(ctx, signal.recentWorkCount, `${pointer}/recentWorkCount`);
    expectStringArray(ctx, signal.evidenceWorkIds, `${pointer}/evidenceWorkIds`);
  });
  if (expectArray(ctx, data.agendaSignals, "/agendaSignals")) data.agendaSignals.forEach((signal, index) => {
    const pointer = `/agendaSignals/${index}`;
    if (!requireFields(ctx, signal, ["theme", "status", "dataQuality", "activeCallCount", "closingSoonCount", "sourceCount", "evidenceCallIds", "nearestDeadlineAt"], pointer)) return;
    expectString(ctx, signal.theme, `${pointer}/theme`);
    expectEnum(ctx, signal.status, AGENDA_STATUSES, `${pointer}/status`);
    expectEnum(ctx, signal.dataQuality, new Set(["complete", "partial", "unavailable"]), `${pointer}/dataQuality`);
    for (const field of ["activeCallCount", "closingSoonCount", "sourceCount"]) expectInteger(ctx, signal[field], `${pointer}/${field}`);
    expectStringArray(ctx, signal.evidenceCallIds, `${pointer}/evidenceCallIds`);
  });
  if (expectArray(ctx, data.opportunities, "/opportunities")) data.opportunities.forEach((opportunity, index) => {
    const pointer = `/opportunities/${index}`;
    if (!requireFields(ctx, opportunity, ["theme", "label", "status", "score", "maximum", "components", "uncertainty", "evidenceWorkIds", "evidenceCallIds", "methodVersion"], pointer)) return;
    expectString(ctx, opportunity.theme, `${pointer}/theme`);
    expectEnum(ctx, opportunity.status, OPPORTUNITY_STATUSES, `${pointer}/status`);
    expectNullableNumber(ctx, opportunity.score, `${pointer}/score`, 0);
    expectNumber(ctx, opportunity.maximum, `${pointer}/maximum`, 100);
    if (expectArray(ctx, opportunity.components, `${pointer}/components`)) opportunity.components.forEach((component, componentIndex) => {
      const componentPointer = `${pointer}/components/${componentIndex}`;
      if (!requireFields(ctx, component, ["key", "maximum", "score", "available", "inputs"], componentPointer)) return;
      expectNullableNumber(ctx, component.score, `${componentPointer}/score`, 0);
    });
    expectEnum(ctx, opportunity.uncertainty?.level, new Set(["low", "medium", "high"]), `${pointer}/uncertainty/level`);
    expectStringArray(ctx, opportunity.evidenceWorkIds, `${pointer}/evidenceWorkIds`);
    expectStringArray(ctx, opportunity.evidenceCallIds, `${pointer}/evidenceCallIds`);
  });
  if (expectArray(ctx, data.warnings, "/warnings")) data.warnings.forEach((warning, index) => {
    const pointer = `/warnings/${index}`;
    if (!requireFields(ctx, warning, ["code", "severity", "message", "affectedRecords"], pointer)) return;
    expectEnum(ctx, warning.severity, new Set(["info", "warning", "error"]), `${pointer}/severity`);
  });
}

function validateQuestions(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "status", "analysisVersion", "classificationVersion", "ontologyVersion", "inputHash", "methodVersion", "minimumEvidenceRecords", "lens", "dataDerived"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectEnum(ctx, data.status, DATASET_STATUSES, "/status");
  for (const field of ["analysisVersion", "classificationVersion", "ontologyVersion", "methodVersion"]) validateVersion(ctx, data[field], `/${field}`);
  expectHash(ctx, data.inputHash, "/inputHash");
  expectInteger(ctx, data.minimumEvidenceRecords, "/minimumEvidenceRecords", 1);
  for (const group of ["lens", "dataDerived"]) {
    if (!expectArray(ctx, data[group], `/${group}`)) continue;
    data[group].forEach((question, index) => {
      const pointer = `/${group}/${index}`;
      if (!requireFields(ctx, question, ["id", "kind", "question", "status", "themes", "evidence"], pointer)) return;
      expectString(ctx, question.id, `${pointer}/id`);
      expectString(ctx, question.question, `${pointer}/question`);
      expectEnum(ctx, question.status, QUESTION_STATUSES, `${pointer}/status`);
      expectEnum(ctx, question.kind, new Set(["lens", "data-derived"]), `${pointer}/kind`);
      if (group === "lens" && question.status !== "framework") ctx.error("invalid-status", `${pointer}/status`, "Lens Question muss framework sein");
      if (group === "dataDerived") {
        for (const field of ["pattern", "label", "count", "minimumEvidenceRecords"]) if (!Object.hasOwn(question, field)) ctx.error("required-field", `${pointer}/${field}`, "erforderliches Feld fehlt");
        expectInteger(ctx, question.count, `${pointer}/count`);
        expectInteger(ctx, question.minimumEvidenceRecords, `${pointer}/minimumEvidenceRecords`, 1);
        if (question.status === "supported" && question.count < question.minimumEvidenceRecords) ctx.error("insufficient-evidence", `${pointer}/count`, "supported unterschreitet die Mindestfallzahl");
      }
      expectStringArray(ctx, question.themes, `${pointer}/themes`);
      if (expectArray(ctx, question.evidence, `${pointer}/evidence`)) {
        question.evidence.forEach((evidence, evidenceIndex) => {
          const evidencePointer = `${pointer}/evidence/${evidenceIndex}`;
          if (!requireFields(ctx, evidence, ["workId", "reason"], evidencePointer)) return;
          expectString(ctx, evidence.workId, `${evidencePointer}/workId`);
          expectString(ctx, evidence.reason, `${evidencePointer}/reason`);
        });
      }
    });
  }
}

function validateSourceHealth(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "status", "sources"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectEnum(ctx, data.status, DATASET_STATUSES, "/status");
  if (!expectArray(ctx, data.sources, "/sources")) return;
  data.sources.forEach((source, index) => {
    const pointer = `/sources/${index}`;
    if (!requireFields(ctx, source, ["source", "status", "checkedAt", "lastSuccessfulAt", "recordCount", "latencyMs", "message"], pointer)) return;
    expectString(ctx, source.source, `${pointer}/source`);
    expectEnum(ctx, source.status, SOURCE_STATUSES, `${pointer}/status`);
    expectInteger(ctx, source.recordCount, `${pointer}/recordCount`);
    if (source.latencyMs !== null) expectInteger(ctx, source.latencyMs, `${pointer}/latencyMs`);
    if (Object.hasOwn(source, "provider")) expectEnum(ctx, source.provider, new Set(["openalex", "arxiv", "crossref"]), `${pointer}/provider`);
    if (Object.hasOwn(source, "role")) expectEnum(ctx, source.role, new Set(["discovery", "enrichment"]), `${pointer}/role`);
    if (Object.hasOwn(source, "modes")) {
      if (expectArray(ctx, source.modes, `${pointer}/modes`)) source.modes.forEach((mode, modeIndex) =>
        expectEnum(ctx, mode, new Set(["core", "broad", "frontier"]), `${pointer}/modes/${modeIndex}`)
      );
    }
    for (const field of ["requestCount", "pageCount", "attempts", "retryCount", "rateLimitEvents"]) {
      if (Object.hasOwn(source, field)) expectInteger(ctx, source[field], `${pointer}/${field}`);
    }
  });
}

function validateSnapshotsIndex(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "generatedAt", "snapshots"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  if (!expectArray(ctx, data.snapshots, "/snapshots")) return;
  data.snapshots.forEach((snapshot, index) => {
    const pointer = `/snapshots/${index}`;
    if (!requireFields(ctx, snapshot, ["id", "generatedAt", "path", "analysisVersion", "inputHash"], pointer)) return;
    expectString(ctx, snapshot.id, `${pointer}/id`);
    validateVersion(ctx, snapshot.analysisVersion, `${pointer}/analysisVersion`);
    expectHash(ctx, snapshot.inputHash, `${pointer}/inputHash`);
    if (!expectString(ctx, snapshot.path, `${pointer}/path`) || !/^\.\/[^\\/]+\.json$/.test(snapshot.path)) {
      ctx.error("invalid-relative-path", `${pointer}/path`, "muss ein direkter relativer Snapshot-Pfad sein");
    }
  });
}

function validateHistoricalSnapshot(ctx, data) {
  if (!requireFields(ctx, data, ["schemaVersion", "snapshotId", "generatedAt", "corpusGeneratedAt", "inputHash", "analysisVersion", "classificationVersion", "queryVersion", "ontologyVersion", "methodVersions", "coverage", "totals", "sourceStatus", "themeCounts", "signals", "warnings"])) return;
  validateVersion(ctx, data.schemaVersion, "/schemaVersion");
  expectString(ctx, data.snapshotId, "/snapshotId");
  expectHash(ctx, data.inputHash, "/inputHash");
  for (const field of ["analysisVersion", "classificationVersion", "queryVersion", "ontologyVersion"]) validateVersion(ctx, data[field], `/${field}`);
  if (requireFields(ctx, data.methodVersions, ["trends", "questions", "opportunities", "snapshot"], "/methodVersions")) {
    for (const field of ["trends", "questions", "opportunities", "snapshot"]) validateVersion(ctx, data.methodVersions[field], `/methodVersions/${field}`);
  }
  if (requireFields(ctx, data.totals, ["found", "analyzed", "publications", "preprints", "calls", "lensQuestions", "dataDerivedQuestions"], "/totals")) {
    for (const key of ["found", "analyzed", "publications", "preprints", "calls", "lensQuestions", "dataDerivedQuestions"]) expectInteger(ctx, data.totals[key], `/totals/${key}`);
  }
  if (expectArray(ctx, data.sourceStatus, "/sourceStatus")) data.sourceStatus.forEach((source, index) => {
    const pointer = `/sourceStatus/${index}`;
    if (!requireFields(ctx, source, ["source", "status", "recordCount"], pointer)) return;
    expectString(ctx, source.source, `${pointer}/source`);
    expectEnum(ctx, source.status, SOURCE_STATUSES, `${pointer}/status`);
    expectInteger(ctx, source.recordCount, `${pointer}/recordCount`);
  });
  if (expectArray(ctx, data.themeCounts, "/themeCounts")) data.themeCounts.forEach((theme, index) => {
    const pointer = `/themeCounts/${index}`;
    if (!requireFields(ctx, theme, ["theme", "count", "journalCount", "preprintCount", "proceedingsCount"], pointer)) return;
    expectString(ctx, theme.theme, `${pointer}/theme`);
    for (const field of ["count", "journalCount", "preprintCount", "proceedingsCount"]) expectInteger(ctx, theme[field], `${pointer}/${field}`);
  });
  if (expectArray(ctx, data.signals, "/signals")) data.signals.forEach((signal, index) => {
    const pointer = `/signals/${index}`;
    if (!requireFields(ctx, signal, ["theme", "publicationTrend", "emergingSignal", "agendaSignal", "opportunityStatus", "opportunityScore", "uncertainty"], pointer)) return;
    expectEnum(ctx, signal.publicationTrend, PUBLICATION_TREND_STATUSES, `${pointer}/publicationTrend`);
    expectEnum(ctx, signal.emergingSignal, EMERGING_STATUSES, `${pointer}/emergingSignal`);
    expectEnum(ctx, signal.agendaSignal, AGENDA_STATUSES, `${pointer}/agendaSignal`);
    expectEnum(ctx, signal.opportunityStatus, OPPORTUNITY_STATUSES, `${pointer}/opportunityStatus`);
    expectNullableNumber(ctx, signal.opportunityScore, `${pointer}/opportunityScore`, 0);
  });
}

function addDuplicateErrors(errors, file, values, kind, code) {
  const seen = new Map();
  for (const { value, pointer } of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    const normalized = kind === "DOI" ? normalizeDoi(value) : value;
    if (seen.has(normalized)) {
      errors.push({ code, file, path: pointer, message: `${kind} ${JSON.stringify(normalized)} ist doppelt (zuerst ${seen.get(normalized)})` });
    } else seen.set(normalized, `${file}:${pointer}`);
  }
}

function validateCrossFileRules(dataRoot, parsed, errors) {
  const worksPages = [...parsed.entries()].filter(([file]) => /^works\/page-\d+\.json$/.test(file));
  if (worksPages.length === 0) errors.push({ code: "required-file", file: "works/page-*.json", path: "/", message: "mindestens eine paginierte Works-Datei fehlt" });

  const works = worksPages.flatMap(([file, page]) => Array.isArray(page.items)
    ? page.items.map((work, index) => ({ file, work, pointer: `/items/${index}` }))
    : []);
  addDuplicateErrors(errors, "works", works.map(({ work, file, pointer }) => ({ value: work.id, pointer: `${file}:${pointer}/id` })), "ID", "duplicate-id");
  addDuplicateErrors(errors, "works", works.filter(({ work }) => work.doi).map(({ work, file, pointer }) => ({ value: work.doi, pointer: `${file}:${pointer}/doi` })), "DOI", "duplicate-doi");

  const declaredTotals = new Set(worksPages.map(([, page]) => page.totalItems).filter(Number.isInteger));
  if (declaredTotals.size > 1) errors.push({ code: "inconsistent-total", file: "works", path: "/totalItems", message: "Works-Seiten deklarieren unterschiedliche totalItems" });
  const declaredTotal = declaredTotals.size === 1 ? [...declaredTotals][0] : null;
  if (declaredTotal !== null && declaredTotal !== works.length) errors.push({ code: "inconsistent-total", file: "works", path: "/totalItems", message: `deklariert ${declaredTotal}, gefunden ${works.length}` });

  const workIds = new Set(works.map(({ work }) => work.id));
  const meta = parsed.get("meta.json");
  if (meta && Number.isInteger(meta.totalFound) && meta.totalFound !== works.length) {
    errors.push({ code: "inconsistent-total", file: "meta.json", path: "/totalFound", message: `deklariert ${meta.totalFound}, Works enthalten ${works.length}` });
  }
  const countsByDataset = {
    publications: works.filter(({ work }) => work.recordType === "publication").length,
    preprints: works.filter(({ work }) => work.recordType === "preprint").length,
    searchIndex: Array.isArray(parsed.get("search-index.json")?.documents) ? parsed.get("search-index.json").documents.length : null,
    calls: Array.isArray(parsed.get("calls.json")?.items) ? parsed.get("calls.json").items.length : null,
    agendaSignals: Array.isArray(parsed.get("agenda-signals.json")?.items)
      ? parsed.get("agenda-signals.json").items.reduce((sum, entry) => sum + (Array.isArray(entry.signals) ? entry.signals.length : 0), 0)
      : null,
    trends: Array.isArray(parsed.get("trends.json")?.publicationTrends) ? parsed.get("trends.json").publicationTrends.length : null,
    questions: parsed.get("questions.json")
      ? (Array.isArray(parsed.get("questions.json").lens) ? parsed.get("questions.json").lens.length : 0)
        + (Array.isArray(parsed.get("questions.json").dataDerived) ? parsed.get("questions.json").dataDerived.length : 0)
      : null,
    sourceHealth: Array.isArray(parsed.get("source-health.json")?.sources) ? parsed.get("source-health.json").sources.length : null,
    snapshots: Array.isArray(parsed.get("snapshots/index.json")?.snapshots) ? parsed.get("snapshots/index.json").snapshots.length : null,
  };
  if (isObject(meta?.datasets)) {
    for (const [name, dataset] of Object.entries(meta.datasets)) {
      if (!isObject(dataset) || typeof dataset.path !== "string" || !dataset.path.startsWith("./") || dataset.path.includes("..")) continue;
      const relativeTarget = dataset.path.slice(2).replaceAll("\\", "/");
      const absoluteTarget = path.resolve(dataRoot, relativeTarget);
      if (!absoluteTarget.startsWith(`${dataRoot}${path.sep}`) && absoluteTarget !== dataRoot) {
        errors.push({ code: "path-escape", file: "meta.json", path: `/datasets/${name}/path`, message: "Pfad verlässt das Datenverzeichnis" });
      } else if (!parsed.has(relativeTarget)) {
        errors.push({ code: "missing-dataset", file: "meta.json", path: `/datasets/${name}/path`, message: `referenzierte Datei ${relativeTarget} fehlt` });
      }
      if (Number.isInteger(dataset.recordCount) && Number.isInteger(countsByDataset[name]) && dataset.recordCount !== countsByDataset[name]) {
        errors.push({ code: "inconsistent-total", file: "meta.json", path: `/datasets/${name}/recordCount`, message: `deklariert ${dataset.recordCount}, gefunden ${countsByDataset[name]}` });
      }
    }
  }

  const searchVersions = parsed.get("search-index.json");
  if (meta && searchVersions) {
    if (meta.queryVersion !== searchVersions.queryVersion) errors.push({ code: "version-mismatch", file: "search-index.json", path: "/queryVersion", message: "stimmt nicht mit meta.json überein" });
    if (meta.ontologyVersion !== searchVersions.ontologyVersion) errors.push({ code: "version-mismatch", file: "search-index.json", path: "/ontologyVersion", message: "stimmt nicht mit meta.json überein" });
  }

  const search = parsed.get("search-index.json");
  if (Array.isArray(search?.documents)) {
    addDuplicateErrors(errors, "search-index.json", search.documents.map((entry, index) => ({ value: entry.id, pointer: `/documents/${index}/id` })), "ID", "duplicate-id");
    search.documents.forEach((entry, index) => {
      if (typeof entry.id === "string" && !workIds.has(entry.id)) errors.push({ code: "unknown-work-id", file: "search-index.json", path: `/documents/${index}/id`, message: "verweist auf keine Works-ID" });
    });
  }

  const calls = parsed.get("calls.json");
  if (Array.isArray(calls?.items)) addDuplicateErrors(errors, "calls.json", calls.items.map((entry, index) => ({ value: entry.id, pointer: `/items/${index}/id` })), "ID", "duplicate-id");
  const callIds = new Set((calls?.items ?? []).map((call) => call.id));

  const questions = parsed.get("questions.json");
  const allQuestions = [
    ...(Array.isArray(questions?.lens) ? questions.lens.map((entry, index) => ({ entry, pointer: `/lens/${index}` })) : []),
    ...(Array.isArray(questions?.dataDerived) ? questions.dataDerived.map((entry, index) => ({ entry, pointer: `/dataDerived/${index}` })) : []),
  ];
  addDuplicateErrors(errors, "questions.json", allQuestions.map(({ entry, pointer }) => ({ value: entry.id, pointer: `${pointer}/id` })), "ID", "duplicate-id");
  allQuestions.forEach(({ entry, pointer }) => entry.evidence?.forEach((evidence, index) => {
    if (typeof evidence.workId === "string" && !workIds.has(evidence.workId)) errors.push({ code: "unknown-work-id", file: "questions.json", path: `${pointer}/evidence/${index}/workId`, message: "verweist auf keine Works-ID" });
  }));

  const trends = parsed.get("trends.json");
  for (const group of ["publicationTrends", "emergingSignals", "agendaSignals", "opportunities"]) {
    if (!Array.isArray(trends?.[group])) continue;
    addDuplicateErrors(errors, "trends.json", trends[group].map((entry, index) => ({ value: entry.theme, pointer: `/${group}/${index}/theme` })), "Theme", "duplicate-id");
    trends[group].forEach((entry, entryIndex) => {
      const workEvidence = entry.evidenceWorkIds ?? entry.recentEvidenceWorkIds ?? [];
      workEvidence.forEach((workId, evidenceIndex) => {
        if (typeof workId === "string" && !workIds.has(workId)) errors.push({ code: "unknown-work-id", file: "trends.json", path: `/${group}/${entryIndex}/evidenceWorkIds/${evidenceIndex}`, message: "verweist auf keine Works-ID" });
      });
      (entry.evidenceCallIds ?? []).forEach((callId, evidenceIndex) => {
        if (typeof callId === "string" && !callIds.has(callId)) errors.push({ code: "unknown-call-id", file: "trends.json", path: `/${group}/${entryIndex}/evidenceCallIds/${evidenceIndex}`, message: "verweist auf keine Call-ID" });
      });
    });
  }
  const trendThemeSets = ["publicationTrends", "emergingSignals", "agendaSignals", "opportunities"]
    .map((group) => new Set((trends?.[group] ?? []).map((entry) => entry.theme)));
  if (trendThemeSets.length && trendThemeSets.some((set) => set.size !== trendThemeSets[0].size || [...set].some((theme) => !trendThemeSets[0].has(theme)))) {
    errors.push({ code: "theme-set-mismatch", file: "trends.json", path: "/", message: "die vier Analysebereiche müssen dieselben Themen enthalten" });
  }

  const snapshotIndex = parsed.get("snapshots/index.json");
  if (Array.isArray(snapshotIndex?.snapshots)) {
    addDuplicateErrors(errors, "snapshots/index.json", snapshotIndex.snapshots.map((entry, index) => ({ value: entry.id, pointer: `/snapshots/${index}/id` })), "ID", "duplicate-id");
    snapshotIndex.snapshots.forEach((entry, index) => {
      if (typeof entry.path !== "string" || !entry.path.startsWith("./")) return;
      const target = `snapshots/${entry.path.slice(2)}`;
      if (!parsed.has(target)) errors.push({ code: "missing-snapshot", file: "snapshots/index.json", path: `/snapshots/${index}/path`, message: `referenzierter Snapshot ${target} fehlt` });
      else if (parsed.get(target)?.snapshotId !== entry.id) errors.push({ code: "snapshot-id-mismatch", file: target, path: "/snapshotId", message: "stimmt nicht mit dem Snapshot-Index überein" });
    });
  }
}

export async function validateDataDirectory(directory) {
  const dataRoot = path.resolve(directory);
  const errors = [];
  let jsonFiles;
  try {
    jsonFiles = await findJsonFiles(dataRoot);
  } catch (error) {
    return { valid: false, errors: [{ code: "data-directory", file: path.relative(process.cwd(), dataRoot), path: "/", message: error instanceof Error ? error.message : String(error) }], files: [] };
  }

  const parsed = new Map();
  for (const filename of jsonFiles) {
    const relativeFile = path.relative(dataRoot, filename).replaceAll("\\", "/");
    if (/(?:^|\/)(?:sample|fixture|fallback)[^/]*\.json$/i.test(relativeFile)) {
      errors.push({ code: "synthetic-fallback", file: relativeFile, path: "/", message: "Produktionsdateiname kennzeichnet Test- oder Fallbackdaten" });
    }
    try {
      parsed.set(relativeFile, JSON.parse(await readFile(filename, "utf8")));
    } catch (error) {
      errors.push({ code: "invalid-json", file: relativeFile, path: "/", message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const requiredFile of REQUIRED_FILES) {
    if (!parsed.has(requiredFile)) errors.push({ code: "required-file", file: requiredFile, path: "/", message: "erforderliche Produktionsdatei fehlt" });
  }

  for (const [file, data] of parsed) {
    const ctx = makeContext(errors, file);
    validateDatesRecursively(ctx, data);
    validateSecurityRecursively(ctx, data);
    if (file === "meta.json") validateMeta(ctx, data);
    else if (/^works\/page-\d+\.json$/.test(file)) validateWorksPage(ctx, data);
    else if (file === "search-index.json") validateSearchIndex(ctx, data);
    else if (file === "calls.json") validateCalls(ctx, data);
    else if (file === "agenda-signals.json") validateAgendaSignals(ctx, data);
    else if (file === "trends.json") validateTrends(ctx, data);
    else if (file === "questions.json") validateQuestions(ctx, data);
    else if (file === "source-health.json") validateSourceHealth(ctx, data);
    else if (file === "snapshots/index.json") validateSnapshotsIndex(ctx, data);
    else if (/^snapshots\/[^/]+\.json$/.test(file)) validateHistoricalSnapshot(ctx, data);
    else ctx.error("unknown-data-file", "/", "keinem versionierten Datenvertrag zugeordnet");
  }

  validateCrossFileRules(dataRoot, parsed, errors);
  return { valid: errors.length === 0, errors, files: [...parsed.keys()] };
}

async function runCli() {
  const dataDirectory = path.resolve(process.argv[2] ?? "site/data");
  const result = await validateDataDirectory(dataDirectory);
  if (!result.valid) {
    for (const error of result.errors) console.error(`${error.file}:${error.path} [${error.code}] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${result.files.length} JSON data file(s) in ${path.relative(process.cwd(), dataDirectory)}.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runCli();
