# Unabhängiges Audit der neun Implementierungsblöcke

Auditdatum: 31. August 2026  
Projekt: `human-ai-research-radar`  
Auditumfang: Quellcode, lokale Laufzeit, lokale automatisierte Prüfungen und read-only externe Statusprüfungen  
Produktive Änderungen: keine; Migrationen, Ingestion und Deployment wurden nicht ausgeführt

## Auditregeln und Ergebnislogik

Die frühere Aussage „alle 9 Blöcke sind umgesetzt“ wurde nicht als Evidenz verwendet. README, Changelog, Dateinamen, Kommentare, UI-Texte und vorhandene Tests wurden allein ebenfalls nicht als Implementierungsnachweis gewertet. Ein `PASS` setzt sowohl implementierten Code als auch einen zum Kriterium passenden Laufzeitnachweis voraus. Wo eine Ziel-D1, Secrets, echte historische Daten, Browserzugriff oder Deploymentzugriff fehlen, wird nicht auf Erfolg geschlossen.

Blockstatus:

| Block | Status | Kurzbegründung |
| --- | --- | --- |
| 1. Datenintegrität, Status und Aktualität | `PARTIAL` | Statuslogik, Versionen, Cache und Fallback-Schutz sind implementiert und getestet; der letzte erfolgreiche Ingestion-Zeitpunkt wird trotz vorhandenen API-Felds nicht eigenständig in der Dashboard-UI angezeigt. |
| 2. D1-Datenhaltung und Versionierung | `PARTIAL` | D1-/Drizzle-Code und sieben Migrationen sind lokal gegen SQLite/D1-kompatible Tests validiert; die lokale Laufzeit-D1 ist nicht migriert und eine tatsächliche Ziel-D1 ist nicht konfiguriert oder geprüft. |
| 3. Core-, Broad- und Frontier-Ingestion | `PARTIAL` | Alle drei Schichten, Cursor-Pagination, arXiv, Enrichment, Retry und Source Health sind implementiert und fixture-basiert geprüft; ein echter vollständiger Ingestion-Lauf fehlt. |
| 4. Calls und Agenda-Signale | `PARTIAL` | Registry, Adapter, Historie, Status, Filter und Signalintegration sind vorhanden; ein eigenständiges Venue-Feld fehlt und persistierte aktuelle Verifikationszeiten konnten ohne migrierte D1 nicht geprüft werden. |
| 5. Themenanalyse und Forschungsfragen | `PASS` | Versionierte, evidenzgebundene Klassifikation und deterministische Forschungsfragen sind im Code vorhanden, persistiert, in der UI sichtbar und mit kontrollierten Laufzeitfällen geprüft. |
| 6. Trends, Emerging Signals und Opportunities | `PARTIAL` | Berechnung und Snapshot-Persistenz sind implementiert und mit kontrollierten Zeitreihen geprüft; es fehlt der zwingende Nachweis aus echten persistierten historischen Ziel-Daten. |
| 7. Forschungsworkflow und UI | `PARTIAL` | Workflow, Suche, Pagination, Filter, Shortlist und Exporte sind implementiert; die Seite liefert lokal HTTP 200, aber Daten-APIs liefern wegen nicht migrierter D1 HTTP 503 und der praktische Browser-/Accessibility-Check war nicht möglich. |
| 8. Validierung, QA und Dokumentation | `PARTIAL` | Die technische Validierungsinfrastruktur ist umfassend und alle lokalen Pflichtchecks bestehen; eine echte wissenschaftliche Validierung mit manuell gelabeltem Goldstandard wurde noch nicht durchgeführt. |
| 9. Release, Deployment und Veröffentlichung | `FAIL` | Kein Git-Commit, keine Ziel-D1-Migration, kein realer Ingestion-Lauf, kein Scheduler, keine Sites-Projekt-ID, kein Deployment und kein Live-Smoke-Test. |

## Ausgangszustand und Inventar

| Gegenstand | Feststellung | Evidenz |
| --- | --- | --- |
| Branch | `NOT_VERIFIABLE` | `git branch --show-current` endet mit `fatal: not a git repository`. |
| Commit-SHA | `NOT_VERIFIABLE` | `git rev-parse HEAD` endet mit `fatal: not a git repository`. |
| Ursprünglicher Git-Status | `NOT_VERIFIABLE` | `git status --short --branch` endet mit `fatal: not a git repository`; im Projekt und direkten Elternverzeichnis fehlen Git-Metadaten. |
| Framework | Vite 8.0.13, vinext 0.0.50, React 19.2.6, Next 16.2.6, Cloudflare Vite Plugin 1.37.1 | `package.json`, `vite.config.ts` |
| Paketmanager | npm 11.17.0 mit `package-lock.json`; Node.js 24.19.0 | `npm.cmd --version`, `node --version` |
| Skripte | `dev`, `build`, `start`, `test`, `lint`, `db:generate`, `ingest`; separater Typecheck via `npx tsc --noEmit` | `package.json` |
| Datenbank | Logische Cloudflare-D1-Bindung `DB`; Drizzle-D1-Adapter; lokale Vite-Konfiguration verwendet eine Platzhalter-Datenbank-ID | `.openai/hosting.json`, `db/index.ts:getD1`, `vite.config.ts:localBindingConfig` |
| Migrationen | Sieben SQL-Dateien `0000` bis `0006` für Quellen, Runs, Works/Versionen, Discoveries, Themen, Trends, Calls, Source Health und Shortlists | `drizzle/*.sql`, `db/schema.ts` |
| Ingestion | OpenAlex, direkte arXiv-Abfrage, DOI-basiertes Crossref-Enrichment und vier offizielle Calls-Adapter | `lib/radar/ingestion.ts`, `lib/radar/openalex.ts`, `lib/radar/arxiv.ts`, `lib/radar/crossref.ts`, `lib/calls/ingestion.ts` |
| Scheduler | Nicht vorhanden | Keine `.github`-Workflows und keine Wrangler-Cron-Konfiguration; die README beschreibt nur eine spätere Einrichtung. |
| APIs | `GET /api/radar`, `GET /api/works`, `GET /api/works/export`, `GET/POST/DELETE /api/shortlist`, `GET /api/audit/export`, `POST /api/ingest` | `app/api/**/route.ts` |
| Tests | 11 Testdateien, 51 Node-Tests | `tests/*.test.mjs`; ausgeführtes `npm.cmd test` |
| Deployment | `.openai/hosting.json` enthält nur `d1: DB` und `r2: null`; keine `project_id`; read-only Sites-Abfrage liefert 0 eigene oder editierbare Sites | `.openai/hosting.json`; Sites `list_sites` am Auditdatum |
| Laufzeitwerte | `INGESTION_TOKEN`, `RADAR_INGESTION_URL`, `OPENALEX_API_KEY`, `CROSSREF_MAILTO` und `RADAR_INGESTION_SAFETY_LIMIT` sind in der Audit-Shell nicht gesetzt | reine Vorhandenheitsprüfung der Umgebungsvariablen; Werte wurden nicht ausgegeben |

## Ausgeführte Befehle und Laufzeitprüfungen

| Befehl/Prüfung | Exit-Code | Ergebnis |
| --- | ---: | --- |
| `git rev-parse --show-toplevel` | 128 | Kein Git-Repository. |
| `git branch --show-current` | 128 | Branch nicht feststellbar. |
| `git rev-parse HEAD` | 128 | Commit nicht feststellbar. |
| `git status --short --branch` | 128 | Ursprünglicher Status nicht feststellbar. |
| `node --version` | 0 | `v24.19.0` |
| `npm.cmd --version` | 0 | `11.17.0` |
| `npx.cmd tsc --noEmit` | 0 | Typecheck ohne Befund. |
| `npm.cmd run lint` | 0 | ESLint ohne Befund. |
| `npx.cmd drizzle-kit check` | 0 | `Everything's fine`; Konsistenz von Schema und Migrationsmetadaten bestätigt. |
| `npm.cmd run build` | 0 | Produktions-Build erfolgreich; nicht blockierende Warnung für den minifizierten Client-Chunk `radar-dashboard` mit 557,49 kB. |
| `npm.cmd test` | 0 | 51 Tests, 51 bestanden, 0 fehlgeschlagen. Nicht blockierende Vite-Warnungen zu Port 24678 und einem EPERM beim Dependency-Cache; Gesamtexit 0. |
| erster `npm.cmd run dev` in Sandbox | 1 | Start scheiterte an `spawn EPERM`; deshalb regelkonform außerhalb der Sandbox wiederholt. |
| lokaler `npm.cmd run dev` außerhalb der Sandbox | 1 nach manueller Beendigung | Server wurde erfolgreich auf `http://localhost:5173` bereit; nach den Smoke-Tests bewusst beendet. |
| `GET /` lokal | 0 (HTTP-Prüfbefehl) | HTTP 200, HTML mit Titel `Human–AI Research Radar`. |
| `GET /api/radar?days=90&scope=ai` lokal | 0 (HTTP-Prüfbefehl) | HTTP 503: D1-Datenbank noch nicht migriert. |
| `GET /api/works?page=1&pageSize=10` lokal | 0 (HTTP-Prüfbefehl) | HTTP 503: D1-Datenbank noch nicht vollständig migriert. |
| `GET /api/works/export?format=csv&scope=ai` lokal | 0 (HTTP-Prüfbefehl) | HTTP 503 wegen nicht lesbarem persistentem Korpus. |
| `GET /api/audit/export?scope=ai` lokal | 0 (HTTP-Prüfbefehl) | HTTP 503 wegen nicht lesbarem persistentem Korpus. |
| `POST /api/ingest` ohne Token lokal | 0 (HTTP-Prüfbefehl) | HTTP 503: `INGESTION_TOKEN` nicht konfiguriert; es wurde keine Ingestion gestartet. |
| Praktischer In-App-Browsercheck | nicht anwendbar | `NOT_VERIFIABLE`: Browser-Runtime scheitert an der Vertrauenskonfiguration für `browser-service.mjs`; kein visueller oder interaktiver Browsernachweis. |
| Sites `list_sites` read-only | nicht anwendbar | 0 eigene und 0 editierbare Sites; kein Deployment nachweisbar. |

Externe read-only Erreichbarkeitsprüfung am Auditdatum: Crossref API, CHI 2027, AHFE 2027 und SAGE Human Relations waren abrufbar; ScienceDirect antwortete mit HTTP 403. OpenAlex- und arXiv-API-URLs wurden von der verwendeten Web-Prüfoberfläche als nicht sicher zu öffnen abgelehnt. Diese Beobachtungen sind kein Ingestion-Nachweis und erzeugten keine Datenbankeinträge.

## Block 1: Datenintegrität, Status und Aktualität — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Keine synthetischen Produktionsdaten | `PASS` | Produktionspfade enthalten keine `FALLBACK_WORKS`, `FALLBACK_TRENDS`, erfundenen Calls oder Imports aus `tests/fixtures`. Bei Leerstand werden leere Zustände geliefert. | `lib/radar/repository.ts:readRadarData`; `lib/calls/repository.ts:readCallsData`; `tests/repository-hygiene.test.mjs` | Repository-Scan plus `npm.cmd test` (`contains no committed environment files...`, Calls-Ausfalltest, Empty-State-Test). | Keine. |
| Explizite Zustände `live`, `partial`, `unavailable` | `PASS` | `dataStatusFromRuns` unterscheidet vollständigen Erfolg, Teilausfall und vollständigen Ausfall; Calls und Trends besitzen gleichartige Statusverträge. | `lib/radar/repository.ts:dataStatusFromRuns`; `app/radar-types.ts:DataStatus` | `radar-validation`, `radar-ingestion-v3`, `radar-calls`, `radar-persistence`; alle bestanden. | Keine. |
| Request-Zeitpunkt, neuester Datensatz und letzter erfolgreicher Ingestion-Lauf getrennt anzeigen | `FAIL` | `dashboardQueriedAt` und `newestPublicationDate` werden angezeigt. `storage.lastIngestionAt` wird von der API geliefert, aber in `radar-dashboard.tsx` nirgends gerendert. Texte „seit letztem Lauf“ ersetzen keinen Zeitpunkt. | `lib/radar/repository.ts:readRadarData`; `app/radar-dashboard.tsx` Aktualitätsleiste | Quellcode-Nutzungsanalyse `rg lastIngestionAt`; nur Typ/API, keine UI-Nutzung. | `lastIngestionAt` als eigenständigen, beschrifteten Zeitpunkt in der Aktualitätsanzeige rendern und testen. |
| „Gefunden“ und „analysiert“ getrennt | `PASS` | `totalFound` wird aus Run-Zählern, `analyzed` aus deduplizierten gelesenen Works gebildet und separat gerendert. | `lib/radar/repository.ts:readRadarData`; `app/radar-dashboard.tsx` Kennzahlen | Release-Fixture-Test und UI-Codeprüfung. | Keine. |
| Cache transparent | `PASS` | API setzt `Cache-Control`; Payload und UI zeigen Cache- und Stale-While-Revalidate-Dauer. | `app/api/radar/route.ts:GET`; `lib/radar/repository.ts:readRadarData`; `app/radar-dashboard.tsx` | Build, gerendertes Markup und Codeprüfung. | Keine. |
| Regelbasierte/explorative Analysen gekennzeichnet | `PASS` | Relevanz ist „regelbasiert“; Emerging/Opportunity werden ausdrücklich explorativ und nicht prognostisch beschrieben. | `app/corpus-browser.tsx:PublicationCard`; `app/radar-dashboard.tsx` Emerging/Methodik | UI-Komponententests und Quellcodeprüfung. | Keine. |
| `analysisVersion` und `queryVersion` | `PASS` | Beide Felder werden erzeugt, typisiert und in Methodik/UI angezeigt. | `lib/radar/repository.ts:readRadarData`; `lib/radar/config/*`; `app/radar-types.ts` | Release-Fixture-Test prüft beide Felder. | Keine. |
| Erfolg, Teilausfall und vollständiger Quellenausfall | `PASS` | Kontrollierte Integrationsfälle prüfen Erfolg, partielles arXiv/Calls-Versagen und vollständiges OpenAlex-Versagen. | `tests/release-candidate.test.mjs`; `tests/radar-validation.test.mjs`; `tests/radar-ingestion-v3.test.mjs` | `npm.cmd test`: 51/51. | Ein zusätzlicher realer Zielumgebungsnachweis gehört zu Block 2/3/9. |

## Block 2: D1-Datenhaltung und Versionierung — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| D1-/Drizzle-Integration im Code | `PASS` | `getD1` liest die Cloudflare-Bindung `DB`; Drizzle verwendet `drizzle-orm/d1`. | `db/index.ts:getD1/getDb`; `cloudflare-env.d.ts`; `vite.config.ts` | Typecheck, Build und Codeprüfung. | Keine auf Codeebene. |
| Migrationen für alle geforderten Entitäten | `PASS` | Sieben Migrationen decken Sources, Runs, Works, Work Versions, Discoveries, Themes, Trend-/Signal-Snapshots, Source Health, Calls/Versionen und Shortlists ab. | `db/schema.ts`; `drizzle/0000...0006.sql` | `npx.cmd drizzle-kit check`; Migrationen werden im Testhelper in Reihenfolge angewendet. | Keine auf lokaler Schemaebene. |
| Ingestion-Metadaten und Fehlerzustände | `PASS` | Runs speichern Status, Version, Limits, Zähler und Fehler; Source Health speichert HTTP-/Fehlerzustand. | `db/schema.ts:ingestionRuns/sourceHealth`; `lib/radar/repository.ts:createIngestionRun/finishIngestionRun/recordSourceHealth` | Persistenz- und Ausfalltests bestanden. | Keine. |
| DOI-/ID-/Titel-Deduplizierung | `PASS` | Lookup-Reihenfolge: DOI, OpenAlex-ID, Source Record, exakter normierter Titel, vorsichtige Titelähnlichkeit mit Datum/Autor. | `lib/radar/repository.ts:findExistingWork/cautiousTitleSimilarity/persistWork` | `radar-persistence` und `radar-ingestion-v3`; bestanden. | Keine. |
| Preprint-/Journalverknüpfung | `PASS` | Ein Work kann getrennte aktuelle Manifestationen `preprint` und `journal` besitzen; beide bleiben verknüpft. | `db/schema.ts:works/workVersions`; `lib/radar/repository.ts:persistWork` | Test „deduplicates a preprint and journal...“ bestanden. | Keine. |
| Abstracts, Topics, Keywords, Datumsfelder persistiert | `PASS` | `work_versions` speichert Abstract, Topics-/Keywords-JSON, Publikations-, Online-, Abruf- und Erstellungsdatum. | `db/schema.ts:workVersions`; `lib/radar/repository.ts:persistWork` | Test „stores complete work metadata...“ bestanden. | Keine. |
| Unveränderliche historische Snapshots | `PASS` | Neue Work Versions und Trend-/Signal-Snapshots werden angehängt; ältere Datensätze bleiben erhalten. | `lib/radar/repository.ts:persistWork/insertTrendSnapshots`; `lib/radar/trend-repository.ts:createThemeSignalSnapshots` | Versions- und Snapshot-Tests bestanden. | Keine. |
| API liest DB und baut Korpus nicht beim Seitenaufruf | `PASS` | `GET /api/radar` und `GET /api/works` rufen ausschließlich Repository-Lesefunktionen auf; Ingestion liegt getrennt unter POST. | `app/api/radar/route.ts`; `app/api/works/route.ts`; `app/api/ingest/route.ts` | Codeprüfung; lokaler Radar-Aufruf endet ehrlich mit D1-503 statt Discovery auszulösen. | Keine. |
| Geschützter manueller Ingestion-Pfad | `PASS` | Ohne Laufzeit-Token 503, bei falschem Token 401; Hashvergleich läuft in konstanter Schleife. | `app/api/ingest/route.ts:POST/tokensMatch`; `scripts/ingest.mjs` | Lokales POST ohne Token: HTTP 503, keine Ingestion. | Zielsecret konfigurieren und autorisierten Lauf später separat prüfen. |
| Empty-State | `PASS` | Eine migrierte leere Testdatenbank liefert `storage.state=empty`, leere Werke/Trends und `unavailable`. | `lib/radar/repository.ts:readRadarData`; `app/radar-dashboard.tsx` | Empty-State-Persistenztest bestanden. | Praktische UI-Prüfung mit migrierter leerer D1 fehlt. |
| Create, Update, Deduplizierung, Fehlerfälle | `PASS` | Integrationstests prüfen alle vier Fälle gegen eine lokale SQLite/D1-kompatible Datenbank. | `tests/radar-persistence.test.mjs`; `tests/helpers/d1.mjs` | `npm.cmd test`: bestanden. | Keine auf Testebene. |
| Datenbankcode vorhanden | `PASS` | Vollständige Repositories und D1-Abstraktion vorhanden. | `db/`, `lib/radar/*repository.ts`, `lib/calls/repository.ts` | Typecheck/Build. | Keine. |
| Migration lokal getestet | `PASS` | Alle sieben SQL-Dateien werden auf einer leeren Testdatenbank angewendet; Integritätsprüfungen laufen. | `tests/helpers/d1.mjs`; `tests/release-candidate.test.mjs` | `drizzle-kit check` und 51 Tests erfolgreich. | Eine lokale Miniflare-D1-Migration wurde nicht ausgeführt. |
| Migration auf tatsächlicher Ziel-D1 | `NOT_VERIFIABLE` | Keine Zielprojekt-ID oder D1-Ressourcen-ID vorhanden; lokaler API-Smoke-Test meldet „noch nicht migriert“. | `.openai/hosting.json`; lokaler `/api/radar` | HTTP 503. | Ziel-D1 binden und Migrationen mit expliziter Berechtigung ausführen. |
| Anwendung liest erfolgreich aus Ziel-D1 | `NOT_VERIFIABLE` | Keine erreichbare Ziel-D1; lokale Daten-APIs liefern 503. | `app/api/radar/route.ts`, Zielumgebung fehlt | Lokale Smoke-Tests der Daten-APIs: 503. | Nach Zielmigration einen echten Read-Smoke-Test ausführen. |

## Block 3: Core-, Broad- und Frontier-Ingestion — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Getrennte Modi Core, Broad, Frontier | `PASS` | `SearchLayer` und Requestparser akzeptieren genau diese drei Schichten; Providerwahl ist schichtabhängig. | `lib/radar/config/search.v3.ts`; `lib/radar/ingestion.ts:runIngestion`; `app/api/ingest/route.ts:parseRequest` | Fixture-Release-Sequenz prüft alle Schichten für `ai` und `field`. | Keine. |
| Versionierte Source-/Query-Konfiguration | `PASS` | `sources-3.0.0`, `search-3.0.0` und schichtspezifische Query-Versionen. | `lib/radar/config/sources.v3.ts`; `lib/radar/config/search.v3.ts` | Query-Pinning-Test bestanden. | Keine. |
| Breite Suchbegriffe | `PASS` | Konfiguration enthält KI-, Human-/Work-, Human-Factors-, Ergonomie-, Organisations- und Psychologiebegriffe. | `lib/radar/config/search.v3.ts` | Konfigurations-/Query-Test und Codeprüfung. | Fachliche Recall-Validierung mit Goldstandard fehlt unter Block 8. |
| OpenAlex-Cursor-Pagination ohne 75er-Limit | `PASS` | Startcursor `*`, Schleife über `next_cursor`, Wiederholungsschutz, Seitengröße 100 und separates Safety Limit. | `lib/radar/openalex.ts:paginateOpenAlex` | Zwei gespeicherte Cursor-Seiten und Safety-Limit-Test bestanden. | Echter Providerlauf fehlt. |
| Direkter arXiv-Adapter | `PASS` | Eigener Atom-Parser, Paginierung mit `start`/`max_results`, Kategorien und Inter-Page-Delay. | `lib/radar/arxiv.ts:paginateArxiv/parseArxivFeed` | Parser- und Paging-Test bestanden. | Echter Providerlauf fehlt. |
| Crossref nur Enrichment | `PASS` | Crossref wird nur bei DOI und Metadatenbedarf aufgerufen; erzeugt keine Discovery-Treffer. | `lib/radar/crossref.ts:enrichWithCrossref`; `lib/radar/ingestion.ts:maybeEnrich` | Codeprüfung und Fixture-Sequenz. | Keine. |
| Relevante Konferenzen | `PASS` | CHI, CSCW/PACMHCI, IUI, HRI, DIS und HFES sind mit OpenAlex-IDs konfiguriert. | `lib/radar/config/sources.v3.ts:CORE_CONFERENCES` | Codeprüfung. | Fachliche Pflege bleibt laufende Aufgabe. |
| Relevante Journals | `PASS` | 23 Kernjournals aus Human Factors, Ergonomie, HCI, Work Design, Psychologie, Sicherheit und Organisation. | `lib/radar/config/sources.v3.ts:CORE_JOURNALS` | Codeprüfung. | Fachliche Abdeckung muss später empirisch validiert werden. |
| Retry, Rate Limit, Source Health | `PASS` | 429/5xx-Retry mit Retry-After/exponentiellem Backoff; arXiv-Pause; Source-Health-Ereignisse. | `lib/radar/http.ts:fetchWithRetry`; `lib/radar/ingestion.ts`; `lib/radar/arxiv.ts` | Ausfall- und Partial-Tests bestanden. | Echter Rate-Limit-Fall beim Provider fehlt. |
| Speicherung der Query-Schicht | `PASS` | `work_discoveries` speichert `search_layer` und `query_version`. | `db/schema.ts:workDiscoveries`; `lib/radar/repository.ts:persistWork` | Ingestion-v3-Test prüft die gespeicherten Werte. | Keine. |
| Deduplizierung | `PASS` | DOI, OpenAlex-ID, Source Record, normierter Titel und vorsichtige Ähnlichkeit implementiert. | `lib/radar/repository.ts` | Deduplizierungsfälle bestanden. | Keine. |
| Fixture-Tests | `PASS` | OpenAlex, arXiv und vollständige Release-Sequenz verwenden gespeicherte Fixtures. | `tests/fixtures/`; `tests/radar-ingestion-v3.test.mjs`; `tests/release-candidate.test.mjs` | `npm.cmd test`: bestanden. | Keine. |
| Realer, nicht gemockter Ingestion-Lauf | `NOT_VERIFIABLE` | Ziel-D1 ist nicht migriert, `INGESTION_TOKEN`/`RADAR_INGESTION_URL` fehlen; eine produktive Ingestion war nicht autorisiert. Externe Erreichbarkeit ersetzt keinen Lauf. | Zielumgebung fehlt | Lokales POST wurde vor DB-Zugriff mit 503 abgewiesen; keine Daten verändert. | Ziel-D1 migrieren, Secrets konfigurieren und einen kontrollierten echten Lauf durchführen. |

## Block 4: Calls und Agenda-Signale — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Datenmodellfelder | `FAIL` | Titel, Typ, Organizer, Beschreibung, offizielle URL, Deadline, Eventdatum, Themen, Capture-/Verifikationszeit, Status und Parser-Version sind vorhanden. Ein eigenständiges `venue`-Feld fehlt; Organizer/Quellenname ist nicht dasselbe wie ein modelliertes Venue. | `db/schema.ts:calls/callVersions/callThemes`; `lib/calls/types.ts:ParsedCall` | Schema- und Codeprüfung. | `venue` als explizites Feld inklusive Migration, Parser, API, UI und Tests ergänzen. |
| Kontrollierte offizielle Registry | `PASS` | Vier freigegebene Quellen mit Adapter, Version und Host-Allowlist. | `lib/calls/config/sources.v1.ts:OFFICIAL_CALL_SOURCES` | Codeprüfung. | Quellen laufend fachlich pflegen. |
| Adapter mit Fixtures, kein generisches Scraping | `PASS` | Vier quellenspezifische Adapter und gespeicherte HTML-Fixtures; keine generische Websuche. | `lib/calls/adapters/*`; `tests/fixtures/calls-*.html` | Adapter-Parser-Test bestanden. | Keine. |
| Status open/closing/expired/unverified | `PASS` | 30-Tage-Closing-Fenster und Verifikationsabhängigkeit sind deterministisch implementiert. | `lib/calls/status.ts:calculateCallStatus` | Status-/Sortiertest bestanden. | Keine. |
| Ablaufbehandlung mit Historie | `PASS` | Abgelaufene Calls bleiben gespeichert; neue Inhalte erzeugen unveränderliche `call_versions`; fehlende Calls werden `unverified`. | `lib/calls/repository.ts:persistCall/markMissingCallsUnverified` | Change-, Ablauf- und Ausfalltests bestanden. | Keine. |
| Calls-Seite mit Filtern | `PASS` | Filter für Typ, Deadline, Quelle und Themencluster. | `app/radar-dashboard.tsx` Calls-Toolbar/`filteredCalls` | UI-Codeprüfung und Build. | Praktischer Browsercheck fehlt unter Block 7. |
| Deadline-Übersicht | `PASS` | Overview zeigt die nächsten drei verifizierten aktiven Deadlines. | `app/radar-dashboard.tsx:nextDeadlines` | Codeprüfung. | Live-Datenanzeige nicht verifizierbar. |
| Agenda-Signal getrennt in Trends | `PASS` | Trend-Snapshot liest Calls separat; Opportunity besitzt eigene Agenda-Komponente; UI beschreibt die Trennung. | `lib/radar/trend-repository.ts`; `lib/radar/trend-analysis.ts:agendaSignal/opportunityComponents` | Calls- und Trendtests bestanden. | Echte Daten fehlen. |
| Parsing, Status, Ablauf, Fehlerfälle | `PASS` | Parservertrag, Inhaltsänderung, manueller Review, 403/503-artige Ausfälle, Historie und Agenda-Trennung werden geprüft. | `tests/radar-calls.test.mjs` | Alle sieben Calls-Tests bestanden. | Keine auf Testebene. |
| Reale Aktualität/`last verified` | `NOT_VERIFIABLE` | CHI, AHFE und SAGE waren extern erreichbar; ScienceDirect lieferte 403. Ohne migrierte D1 existiert kein aktuell persistierter `verifiedAt`-/`lastCheckedAt`-Nachweis der Anwendung. | Offizielle Registry-URLs; `lib/calls/repository.ts:readCallsData` | Read-only Webprüfung; lokale Radar-API 503. | Echte Calls-Ingestion gegen Ziel-D1 durchführen und gespeicherte Verifikationszeiten prüfen. |
| Keine statischen/erfundenen Calls; Verifikationszeitpunkt | `PASS` | Produktionscode erzeugt keine Ersatz-Calls. Unverifizierte Datensätze werden explizit so markiert; verifizierte Calls benötigen `verified_at`. | `lib/calls/repository.ts:readCallsData`; `app/radar-dashboard.tsx` | Ausfalltest bestätigt 0 erfundene Calls. | Aktuelle produktive Werte bleiben nicht verifizierbar. |

## Block 5: Themenanalyse und Forschungsfragen — `PASS`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Versionierte Themenontologie | `PASS` | Ontologie `human-work-themes-2.0.0`, Klassifikation `weighted-lexical-2.0.0`. | `lib/radar/config/themes.v2.ts` | Typecheck und Klassifikationstests. | Keine. |
| Titel, Abstract, Keywords, OpenAlex Topics | `PASS` | Alle vier Felder werden mit konfigurierten Gewichten ausgewertet. | `lib/radar/classification.ts:classifyThemeEvidence` | Mehrquellen-Evidenztest bestanden. | Keine. |
| Normalisierung und Wortgrenzen | `PASS` | Unicode-/Trennzeichen-Normalisierung und Tokenfolgen verhindern Teilworttreffer; Ausschlussphrasen entfernen generisches Machine Learning. | `lib/radar/classification.ts:normalizeAnalysisText/containsSequence/removeExcludedPhrases` | Tests mit `distrust`, `trusted` und `machine learning` bestanden. | Keine. |
| Keine Drei-Themen-Begrenzung | `PASS` | Klassifikationsfunktion gibt alle Themen über dem Schwellenwert zurück. | `lib/radar/classification.ts:classifyThemeEvidence` | Kontrollfall liefert mehr als drei, konkret sechs Themen. | Keine. |
| Score und Evidenz gespeichert/angezeigt | `PASS` | `work_themes` speichert Score, Versionsfelder und Evidenz-JSON; Publication Card zeigt Score, Trefferterm, Feld und Gewicht. | `db/schema.ts:workThemes`; `lib/radar/repository.ts:persistWork`; `app/corpus-browser.tsx:PublicationCard` | Persistenz- und UI-Komponententest bestanden. | Keine. |
| Lens vs. datenabgeleitete Fragen | `PASS` | Unterschiedliche Typen und UI-Sektionen; Lens Questions kommen aus der Ontologie, abgeleitete Fragen aus Ko-Okkurrenzen. | `lib/radar/questions.ts:buildLensQuestions/buildResearchQuestions`; Themen-Tab | Questions-Tests und UI-Codeprüfung. | Keine. |
| Belegbare Evidenz | `PASS` | Abgeleitete Fragen enthalten Work-ID, Titel und URL konkreter Publikationen; mindestens drei Records für `supported`. | `lib/radar/questions.ts:pairQuestion` | Evidenztest mit vier Works bestanden. | Calls sind kein Eingang dieser Fragen, aber das Kriterium erlaubt Artikel- oder Call-Evidenz. |
| Geringe Evidenz sichtbar | `PASS` | Unterhalb der Schwelle wird `insufficient` mit Zahl und Erklärung ausgegeben; UI zeigt „Zu wenig Evidenz“. | `lib/radar/questions.ts:insufficientQuestion`; `app/radar-dashboard.tsx` | Insufficient-Test bestanden. | Keine. |
| Optionale LLM-Nutzung | `PASS` | Es gibt keine LLM-Analyse; damit entsteht kein ungesicherter Clientaufruf. Die deterministische Analyse ist der primäre und vollständige Pfad. | Keine Modell-SDK-Abhängigkeit; `lib/radar/questions.ts` | Code-/Dependency-Scan und Tests. | Nur bei späterer LLM-Ergänzung wären Serverbetrieb, Cache, Versionierung und Evidenzbindung erforderlich. |
| Deterministischer Fallback | `PASS` | Klassifikation und Fragen sind vollständig deterministisch. | `lib/radar/classification.ts`; `lib/radar/questions.ts` | Wiederholbare Unit-/Integrationstests. | Keine. |
| Mehrdeutigkeit/Fehlklassifikation | `PASS` | Teilwort- und Ausschlussfälle sowie unterschiedlich breite Vokabulare werden geprüft und transparent gemacht. | `tests/radar-analysis-v2.test.mjs`; `lib/radar/questions.ts:buildThemeAnalysis` | Alle fünf Analyse-Tests bestanden. | Eine wissenschaftliche Fehlklassifikationsrate fehlt unter Block 8. |

## Block 6: Trends, Emerging Signals und Opportunities — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Absolute Zahlen und Rate pro 1.000 | `PASS` | Fenster enthalten `absoluteCount`, Vergleichsfeld-Nenner und `perThousand`. | `lib/radar/trend-analysis.ts:windowMetric` | Kontrollierter Zeitreihentest: 20 absolut, 10 pro 1.000. | Keine auf Berechnungsebene. |
| Journal-/Preprint-Anteile | `PASS` | Typzähler und Prozentanteile getrennt. | `windowMetric` | Test: 75 % Journal, 25 % Preprint. | Keine. |
| Kurz-/Langfristwachstum | `PASS` | Zwei 2-Jahres- und zwei 4-Jahresfenster; Mindestfallzahl vor Rate. | `buildThemeSignal/growthPercent` | Kontrollierter Test bestanden. | Keine. |
| Beschleunigung | `PASS` | Differenz aufeinanderfolgender kurzfristiger Wachstumsraten. | `buildThemeSignal` | Test prüft Prozentpunkte und Klassifikation. | Keine. |
| Quellenvielfalt | `PASS` | Source Count, Venue Count, Shannon-Diversität und größter Venue-Anteil. | `lib/radar/trend-analysis.ts:diversity` | Diversitätstest bestanden. | Keine. |
| Calls-/Agenda-Signal | `PASS` | Verifizierte Calls werden thematisch separat eingelesen. | `lib/radar/trend-repository.ts`; `agendaSignal` | Trennungstest bestanden. | Reale Calls-Daten fehlen. |
| Mindestfallzahl/Datenqualität | `PASS` | Minimum fünf; fehlender Nenner und schwache Fenster führen zu `insufficient`/null Score. | `qualityStatus/opportunity`; Trendkonfiguration | Mindestfallzahltest bestanden. | Keine. |
| Gleich lange abgeschlossene Fenster | `PASS` | Fenstergrenzen sind symmetrisch und schließen YTD aus. | `buildThemeSignal` | Test vergleicht `yearCount`. | Keine. |
| YTD/Indexierungsverzögerung | `PASS` | Laufendes Jahr immer ausgeschlossen; in ersten 120 Tagen zusätzlich Vorjahr. | `latestStableCompleteYear/buildTrendAnalysis` | Februar-/August-Test bestanden. | Keine. |
| Change-Point-Methode | `PASS` | Poisson-Näherung `z=(neu-alt)/sqrt(neu+alt)`, Schwelle 1,96, Mindestfallzahl. | `detectEqualWindowChangePoint` | Drei kontrollierte Fälle bestanden. | Methodisch bleibt es eine Heuristik. |
| Trennung der vier Signale | `PASS` | Eigene Objekte für Observed, Emerging, Agenda und Opportunity. | `lib/radar/trend-analysis.ts`; `app/radar-dashboard.tsx:TrendThemeCard/OpportunityCard` | Trennungstest bestanden. | Keine. |
| Transparenter Opportunity Score | `PASS` | Vier sichtbare Komponenten zu maximal 25 Punkten, Rationale, Qualitätsstatus und Widersprüche. | `opportunityComponents/opportunity/contradictions`; `OpportunityCard` | Komponentensummen- und Konflikttest bestanden. | Keine. |
| Keine statischen Trendtexte | `PASS` | Interpretationen werden aus aktuellen Kennwerten erzeugt; bei fehlenden Snapshots gibt es Empty-State statt Ersatzwert. | `lib/radar/trend-analysis.ts`; `app/radar-dashboard.tsx` | Code- und Fallback-Scan. | Keine. |
| Keine unbelegte Forecast-Aussage | `PASS` | UI und Interpretationen nennen explorative Signale und vermeiden Zukunftsprognosen. | `observedTrend/emergingSignal`; Methodik-UI | Codeprüfung. | Keine. |
| Kontrollierte Zeitreihentests | `PASS` | Fenster, YTD, Raten, Wachstum, Beschleunigung, Diversität, Change Point und Komponenten geprüft. | `tests/radar-trend-analysis.test.mjs` | Alle fünf Tests bestanden. | Keine. |
| Persistierte reale historische Daten/Snapshots | `NOT_VERIFIABLE` | Snapshot-Code und append-only Tests existieren, aber nur mit Fixtures/Testdaten. Die lokale Ziel-API liefert wegen nicht migrierter D1 503; keine realen historischen Ziel-Snapshots sind zugänglich. | `lib/radar/trend-repository.ts:createThemeSignalSnapshots/readThemeSignalAnalysis`; `theme_signal_snapshots` | Fixture-Persistenztest bestanden; realer API-Read fehlgeschlagen. | Echte mehrjährige Ingestion und Trend-Snapshots in der Ziel-D1 erzeugen und anschließend API/UI prüfen. |

## Block 7: Forschungsworkflow und UI — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Sieben Workflow-Navigationen | `PASS` | Overview, New Publications, Landscape, Emerging, Calls, Opportunities und Methodik sind Tabs. | `app/radar-dashboard.tsx` Tabs | Gerenderter HTML-Test und lokales `GET /` HTTP 200. | Interaktion im echten Browser fehlt. |
| Erster Viewport/Inhalte | `PARTIAL` | Overview-Code enthält neue Publikationen, Deadlines, Emerging Signals sowie Quellenstatus/Aktualität. Ohne migrierte D1 konnte der datenhaltige Zustand nicht praktisch gerendert werden. | `app/radar-dashboard.tsx` Overview | Codeprüfung; lokale Seite 200, Radar-API 503. | Mit realen Daten und Browser in Desktop-/Mobile-Viewport prüfen. |
| Serverseitige Suche/Pagination | `PASS` | SQL-Suche über Titel, Abstract, Autor, DOI und Quelle; `LIMIT/OFFSET`, Gesamtzahl und Seiten. | `lib/radar/corpus-repository.ts:searchCorpus`; `app/api/works/route.ts` | Workflow-Integrationstest bestanden. | Ziel-D1-Lasttest fehlt. |
| Filter/Sortierung | `PASS` | Layer, Venue-Art, Venue, Thema, Typ, Zeitraum, OpenAlex Topic; Sortierung nach Datum, Relevanz, Zitationen, Emerging. Study Type ist ehrlich deaktiviert. | `corpus-repository.ts`; `app/corpus-browser.tsx` | Filter-/Sortiertest und UI-Test bestanden. | Strukturierte Study-Type-Metadaten bleiben fachlich offen. |
| Shortlist | `PASS` | Authentifizierte Speicherung in D1, anonyme Browser-Speicherung; DB-Fehler führen nicht zum stillen Fallback. | `app/use-shortlist.ts`; `app/api/shortlist/route.ts`; `app/chatgpt-auth.ts` | Isolationstest und UI-Semantiktest bestanden. | Praktischer Auth-/Browser-Test fehlt. |
| BibTeX-/CSV-Export | `PASS` | Beide Formate, gleiche Filter, Limit 5.000 und Truncation-Header. | `app/api/works/export/route.ts`; `lib/radar/export.ts` | Exporttest bestanden; lokaler echte API-Aufruf 503 wegen D1. | Ziel-D1-Export-Smoke-Test. |
| DOI, Quelle, Abstract, Themen-Evidenz, Datenstatus | `PASS` | Publication Card rendert alle geforderten Felder. | `app/corpus-browser.tsx:PublicationCard` | UI-Komponententest bestanden. | Praktischer Browsercheck fehlt. |
| Wöchentliche Shortlist aus Persistenz | `PASS` | UTC-Woche ist am Ende des jüngsten erfolgreichen Runs verankert. | `lib/radar/corpus-repository.ts:latestSuccessfulRun/utcWeek/searchCorpus` | Workflow-Test prüft exakte Grenzen. | Ziel-D1-Nachweis fehlt. |
| Neu seit letztem Lauf | `PASS` | Filter basiert auf `works.created_at` und Run-ID des jüngsten erfolgreichen Runs. | `corpus-repository.ts:buildConditions` | Workflow-Test bestanden. | Ziel-D1-Nachweis fehlt. |
| Responsive Darstellung | `PARTIAL` | Breakpoints bei 760/460 px und responsive Grid-/Stack-Regeln vorhanden. | `app/globals.css` | CSS-Vertragstest bestanden. | Keine praktische Viewport-Prüfung. |
| Tastatur/Fokus/Semantik/ARIA | `PARTIAL` | Standardcontrols, sichtbare Fokusregeln, semantische Sections, ARIA-Labels, Alert-/Statusrollen und Reduced Motion sind im Code vorhanden. | `app/*.tsx`; `app/globals.css`; UI-Primitives | Statisches Markup/CSS getestet. | Kein echter Tastatur-, Fokus- oder Screenreader-Durchlauf. |
| Lade-, Fehler-, Empty-States | `PASS` | Skeletons, Fetch-Fehlerbanner, Initialisierungs- und domänenspezifische Empty-States implementiert. | `app/radar-dashboard.tsx:LoadingState/EmptyState`; `app/corpus-browser.tsx` | UI-Code-/Komponententests; lokale API-503 bestätigt Fehlerpfad serverseitig. | Visuelle Browserprüfung fehlt. |
| Geeignete UI-/E2E-Tests | `PARTIAL` | SSR-Markup- und Komponententests existieren; kein browserbasierter E2E-Test. | `tests/rendered-html.test.mjs`; `tests/ui-components.test.mjs` | Tests bestanden. Browser-Control scheiterte an Vertrauenskonfiguration. | Playwright/Browser-E2E und Accessibility-Scan in funktionsfähiger Umgebung ausführen. |

## Block 8: Validierung, QA und Dokumentation — `PARTIAL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Automatisierte Fach-/Techniktests | `PASS` | Query, Cursor, arXiv, Deduplizierung, Themen, Calls, Trends, Opportunities und Ausfälle sind abgedeckt. | `tests/*.test.mjs` | `npm.cmd test`: 51/51. | Browser-E2E separat in Block 7. |
| Plausibilitätswarnungen | `PASS` | Nulltreffer, Quellenrückgang, Duplikate, fehlende Abstracts, veraltete Runs, partielle/vollständige Ausfälle. | `lib/radar/quality.ts`; `lib/radar/config/data-quality.v1.ts` | Validation-Tests bestanden. | Schwellenwerte fachlich weiter validieren. |
| Audit-CSV für menschliche Bewertung | `PASS` | Exportiert bis 5.000 reale gespeicherte Treffer und leere manuelle Felder. | `app/api/audit/export/route.ts`; `lib/radar/export.ts:worksToAuditCsv` | Audit-Exporttest bestanden; echter lokaler Endpunkt 503 ohne D1. | Nach realer Ingestion Export praktisch prüfen. |
| Goldstandard ohne erfundene Labels | `PASS` | CSV enthält nur Header; Records-Konstante leer; Schema erzwingt manuelle Verifikation. | `evaluation/*`; `lib/radar/config/gold-standard.v1.ts` | Hygiene-Test bestanden. | Echte manuelle Annotation durchführen. |
| Precision/Recall nur bei echten Labels | `PASS` | Ohne Labels bleiben beide Werte `null`; Berechnung nutzt ausschließlich `manually_verified`. | `computeRetrievalMetrics` | Methodik-/Goldstandard-Test bestanden. | Keine Kennzahlen bis zur Annotation behaupten. |
| Versionierte Methodendokumentation | `PASS` | Methodikversion 1.0.0 dokumentiert Quellen, Suche, Klassifikation, Trends, Calls, QA und Grenzen. | `docs/methodology-1.0.0.md` | Dokument-/Codeabgleich. | Bei Methodenänderungen gemeinsam versionieren. |
| Maschinenlesbares Methodenobjekt/API | `PASS` | Manifest enthält alle Versionsstände, Quellen, Regeln, Qualität und Evaluation; Radar-API liefert es. | `lib/radar/config/methodology.v1.ts:METHODOLOGY_MANIFEST`; `readRadarData` | Validation-Test bestanden. | Produktiver API-Nachweis fehlt. |
| README für Betrieb | `PASS` | Setup, Migration, Ingestion, Scheduler, Secrets und Deployment dokumentiert. | `README.md` | Dokumentprüfung. | Dokumentation ersetzt keine Ausführung. |
| Secret-Scan | `PASS` | Custom-Hygienetest sucht nach Private Keys, API-Key-/Bearer-Mustern und `.env`; keine Treffer. | `tests/repository-hygiene.test.mjs` | Test bestanden. | Kein externer umfassender Secret-/Dependency-Scanner ausgeführt. |
| Keine synthetischen Produktionsdaten | `PASS` | Produktionspfade und Hygiene-Test ohne Fixture-/Example-Imports oder Fallback-Korpora. | `app/`, `lib/`, Hygiene-Test | Scan/Test bestanden. | Keine. |
| Build, Tests, Typecheck, Lint | `PASS` | Alle vier Befehle enden mit Exit 0. | `package.json`, `tsconfig.json`, ESLint-Konfiguration | Build 0; Test 51/51; Typecheck 0; Lint 0. | Nicht blockierende Bundle-/Vite-Warnungen beobachten. |
| Tatsächliche wissenschaftliche Validierung | `NOT_VERIFIABLE` | Der Goldstandard ist absichtlich leer; Precision und Recall sind `null`. Es existiert keine manuell gelabelte Stichprobe und keine empirische Recall-/Precision-Auswertung. | `evaluation/gold-standard.csv`; `computeRetrievalMetrics`; Methodikmanifest | Test bestätigt korrektes Zurückhalten der Metriken. | Reale Treffer manuell annotieren, Goldstandard versionieren und erst dann Kennzahlen berechnen. |

## Block 9: Release, Deployment und Veröffentlichung — `FAIL`

| Kriterium | Status | Konkrete Evidenz | Pfad/Funktion oder Komponente | Ausgeführter Test/Laufzeitnachweis | Noch fehlende Arbeit |
| --- | --- | --- | --- | --- | --- |
| Abschließender Release-Check | `PARTIAL` | Lokale technische Checks wurden ausgeführt und bestehen; Zielumgebungschecks fehlen. | Dieser Audit; `CHANGELOG.md` | Build/Test/Typecheck/Lint/Drizzle 0. | Release-Check nach Zielmigration und Ingestion wiederholen. |
| Migration gegen vorgesehene Datenbank | `FAIL` | Keine Ziel-D1 konfiguriert; lokaler Radar-Endpunkt meldet unmigrierte D1. | `.openai/hosting.json`; lokaler API-Smoke-Test | HTTP 503. | Ziel-D1 binden und Migrationen autorisiert anwenden. |
| Erfolgreicher realer Ingestion-Lauf | `FAIL` | Secrets und Ziel-D1 fehlen; nur Fixture-Sequenz vorhanden. | Laufzeitumgebung; `scripts/ingest.mjs` | POST ohne Token: HTTP 503, keine Ingestion. | Kontrollierten echten vollständigen Lauf ausführen. |
| Source Health geprüft | `NOT_VERIFIABLE` | Source-Health-Code/Tests vorhanden, aber keine Ziel-D1-Runs. Externe Einzelabrufe sind kein gespeicherter Source-Health-Nachweis. | `lib/radar/quality.ts`; `source_health` | Fixture-Tests; keine Live-Daten. | Nach echtem Lauf Zielwerte prüfen. |
| Calls-Aktualität geprüft | `NOT_VERIFIABLE` | Einzelne offizielle Seiten erreichbar, ScienceDirect 403; kein persistierter Live-Verifikationsstand. | Calls-Registry/Ziel-D1 fehlt | Read-only Webcheck; lokale API 503. | Echte Calls-Ingestion und manuelle Prüfung geänderter/gesperrter Quellen. |
| Sicherheitsprüfung | `PARTIAL` | Tokenprüfung, Secret-Hygiene und private Shortlist-Cache-Regeln geprüft; kein produktiver Security-/Dependency-/Header-Test. | `app/api/ingest/route.ts`; `tests/repository-hygiene.test.mjs` | Tests bestanden. | Produktive Header, Zugriffsschutz, Secrets, Dependencies und Berechtigungen prüfen. |
| Accessibility-Prüfung | `PARTIAL` | Automatisierte Markup-/CSS-Verträge bestehen; praktischer Browser-, Tastatur- und Screenreader-Test fehlt. | `tests/ui-components.test.mjs`; `app/globals.css` | Komponententests; Browserverbindung nicht möglich. | Praktische Prüfung durchführen. |
| Keine synthetischen Produktionsdaten | `PASS` | Scan und Tests ohne Produktionsfallbacks. | Produktionspfade/Hygienetest | Test bestanden. | Vor Release erneut scannen. |
| Changelog/Release-Dokumentation | `PASS` | Changelog und bestehender RC-Bericht vorhanden. | `CHANGELOG.md`; `docs/release-candidate-0.1.0.md` | Dokumentprüfung; Aussagen darin nicht als Implementierungsbeleg verwendet. | Nach tatsächlichem Release aktualisieren. |
| Commit-/PR-Nachweis | `FAIL` | Kein Git-Repository; Branch, SHA, Status und PR nicht feststellbar. | Projektverzeichnis | Git-Befehle Exit 128. | Git-Metadaten wiederherstellen, Änderungen committen und PR/Review nachweisen. |
| Deployment-Konfiguration | `FAIL` | Nur logische D1-Bindung, keine `project_id`; kein Wrangler-Ziel-/Cron-File. | `.openai/hosting.json`; Dateiinventar | Read-only Sites-Abfrage: keine Site. | Bestehendes Zielprojekt verknüpfen oder autorisiert neu anlegen; Runtime-Konfiguration setzen. |
| Erreichbares Deployment | `FAIL` | Sites liefert 0 eigene/editierbare Sites; keine Live-URL. | Sites-Projektbestand | Read-only `list_sites`. | Version speichern und nach Freigabe deployen. |
| Live-Smoke-Test Seiten/APIs | `FAIL` | Keine Live-URL. Lokale Seite 200, lokale Daten-APIs 503; dies ist kein Live-Test. | Ziel fehlt | Lokale HTTP-Smokes dokumentiert. | Nach Deployment Hauptseite und alle Kern-APIs live prüfen. |
| Deployed Commit/Version entspricht Audit | `NOT_VERIFIABLE` | Weder Commit-SHA noch Deploymentversion existiert. | Git/Sites fehlen | Git Exit 128; Sites leer. | Audit-SHA committen, exakt diese Version deployen und Zuordnung prüfen. |
| Automatischer Scheduler konfiguriert und gelaufen | `FAIL` | Keine Cron-/CI-Konfiguration; README sagt ausdrücklich, dass kein Scheduler aktiviert ist. | kein `.github`, kein Wrangler-Cron | Dateiinventar/Code-Suche. | Scheduler im Zielsystem konfigurieren, Secret sicher hinterlegen und erfolgreichen Lauf nachweisen. |

## Gesamturteile

| Urteil | Ergebnis | Begründung |
| --- | --- | --- |
| Quellcode vollständig implementiert | **NEIN** | Pflichtlücken: fehlende sichtbare Zeitangabe des letzten erfolgreichen Ingestion-Laufs, fehlendes Calls-Venue-Feld sowie fehlende Release-/Scheduler-/Deployment-Integration. |
| Lokal automatisiert geprüft | **JA** | Build, Typecheck, Lint, Drizzle-Check und alle 51 Tests enden mit Exit 0. Dies gilt nur für die vorhandene lokale und fixture-basierte Prüftiefe. |
| Mit realen Daten End-to-End geprüft | **NEIN** | Keine migrierte Ziel-D1 und kein echter vollständiger Ingestion-Lauf; lokale Daten-APIs liefern HTTP 503. |
| Produktiv veröffentlicht und live geprüft | **NEIN** | Keine Site, keine Live-URL, kein Deployment, kein Commitnachweis und kein Scheduler. |

## Kritische Blocker

1. Git-Repository/Commit-SHA fehlen; ein reproduzierbarer Release-Artefaktbezug ist unmöglich.
2. Es gibt keine konfigurierte und migrierte Ziel-D1; lokale Daten-APIs liefern 503.
3. Laufzeit-Secrets und ein echter vollständiger Ingestion-Lauf fehlen.
4. Calls besitzen kein eigenständiges `venue`-Feld; aktuelle persistierte Verifikationszeiten fehlen.
5. Reale historische Trend-/Signal-Snapshots fehlen.
6. Praktische Browser-, Tastatur-, Responsive- und Screenreader-Prüfungen fehlen.
7. Manuell gelabelter Goldstandard und wissenschaftliche Precision-/Recall-Validierung fehlen.
8. Sites-Projekt, Deployment, Live-Smoke-Test und automatischer Scheduler fehlen.

Alle 9 Blöcke vollständig und erfolgreich umgesetzt: NEIN
