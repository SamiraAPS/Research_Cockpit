# Human–AI Research Radar

Ein Forschungsdashboard für Publikationen, Preprints, zentrale Fragestellungen und Trends an der Schnittstelle von Psychologie, Human Factors, Ergonomie, Work Design und künstlicher Intelligenz.

## Datenfluss

Das Dashboard liest ausschliesslich aus einem persistenten Cloudflare-D1-Datenbestand. Getrennte Ingestion-Läufe fragen OpenAlex und arXiv ab, normalisieren und deduplizieren Werke und schreiben unveränderliche Werkversionen sowie historische Trend-Snapshots. Crossref wird ausschliesslich zur DOI-basierten Metadatenanreicherung verwendet und ist keine zusätzliche Discovery-Quelle. Ein Seitenaufruf baut den Forschungskorpus nicht neu auf.

Die versionierte Suchkonfiguration liegt in `lib/radar/config/search.v3.ts` und `lib/radar/config/sources.v3.ts`:

- `core`: kuratierte Kernjournals sowie CHI, CSCW/PACMHCI, IUI, HRI, DIS und HFES
- `broad`: feldweite OpenAlex-Suche ohne feste Journalliste
- `frontier`: Preprints, Proceedings und direkte arXiv-Signale

Jeder Treffer speichert Suchschicht und Query-Version in `work_discoveries`. OpenAlex wird per Cursor vollständig paginiert. arXiv wird seitenweise abgefragt und zwischen seriellen Requests mit einer Pause geschont. HTTP 429 und vorübergehende Serverfehler werden mit begrenztem exponentiellem Backoff wiederholt; der Zustand von OpenAlex, arXiv und Crossref wird getrennt erfasst.

Der Datenstatus für Publikationen, Preprints, Trends und Calls wird getrennt aus den jeweiligen Ingestion-Läufen abgeleitet. Ist die migrierte Datenbank noch leer, zeigt die Oberfläche einen Initialisierungszustand und keine Beispieldaten.

## Versionierte Themenanalyse und Forschungsfragen

Die Themenontologie mit Synonymen, einfachen sprachlichen Varianten und expliziten Ausschlüssen liegt in `lib/radar/config/themes.v2.ts`. Die Klassifikation normalisiert Unicode, Gross-/Kleinschreibung und Trennzeichen und sucht anschliessend vollständige Wörter beziehungsweise Tokenfolgen. Dadurch löst beispielsweise `trust` nicht in `distrust` aus; generische KI-Phrasen wie `machine learning` werden nicht als arbeitsbezogenes Lernen gewertet.

Jede Zuordnung erhält einen additiven, nachvollziehbaren Score:

- Titelbegriff: +4
- Abstractbegriff: +1
- Keyword: +3
- OpenAlex Topic: +2

Ab Score 2 wird ein Thema zugeordnet. Pro Datenfeld und Ontologiekonzept zählt höchstens ein Treffer; Häufigkeitswiederholungen desselben Begriffs blähen den Score nicht auf. Es gibt keine Begrenzung auf drei Themen. `work_themes` speichert Analyse-, Klassifikations- und Ontologieversion, Score sowie die strukturierte Evidenz mit Datenfeld, Konzept, Trefferbegriff und Gewicht. Der Score erklärt eine Zuordnung; er ist weder ein Qualitätsmass noch zwischen Themen direkt vergleichbar. Die API liefert deshalb zusätzlich die jeweilige konfigurierte Vokabularbreite und einen expliziten Vergleichsvorbehalt.

Forschungsfragen werden in zwei Typen getrennt:

- Theoretische Lens Questions sind vorab in der Ontologie festgelegt und werden nicht aus Trefferhäufigkeiten abgeleitet.
- Datenabgeleitete Research Questions entstehen deterministisch aus belegbaren Themen-Ko-Okkurrenzen. Eine gestützte Frage benötigt mindestens drei konkrete Publikations-IDs; andernfalls wird ausschliesslich der Status `insufficient` mit „zu wenig Evidenz“ ausgegeben.

Eine LLM-Analyse ist in diesem Block bewusst nicht aktiviert. Die vollständige Analyse funktioniert deterministisch ohne externe Modell-API. Bereits vorhandene Klassifikationen aus früheren Analyseversionen werden durch die Migration als `legacy-unscored` gekennzeichnet und nicht für neue datenabgeleitete Fragen verwendet. Ein regulärer erneuter Publikations-Ingestion-Lauf klassifiziert diese Werke mit der aktuellen Version neu.

## Calls als eigenständiges Agenda-Signal

Calls werden getrennt vom Publikationskorpus gespeichert, gezählt und dargestellt. Sie zeigen institutionelle Nachfrage und Agenda-Setzung, nicht wissenschaftliche Evidenz und nicht die künftig zu erwartende Publikationsmenge. Ihr Agenda-Signal fliesst in Block 6 als eine klar sichtbare, separat ausgewiesene Komponente in die Opportunity-Analyse ein; es wird nicht mit Publikationszahlen vermischt.

Die versionierte Registry `lib/calls/config/sources.v1.ts` enthält ausschliesslich fest freigegebene offizielle Quellen von ACM CHI, AHFE, Elsevier/ScienceDirect und SAGE. Jede Quelle hat einen eigenen Adapter, eine Host-Allowlist sowie eine Quellen- und Parser-Version. Es gibt keine generische Websuche und keine statischen Ersatz-Calls. Gespeicherte HTML-Fixtures unter `tests/fixtures/` dienen ausschliesslich reproduzierbaren Parser-Tests.

Ein erfolgreicher Erstabruf legt den verifizierten Ausgangsstand an. Ändert sich die relevante, geparste Struktur oder der Inhalt einer Quelle, erhält sie den Status `changed`; ein verletzter Parservertrag erhält `parser_error`. Betroffene Calls werden bis zur manuellen Prüfung als `unverified` ausgeliefert. Die vorherigen Fassungen bleiben unveränderlich in `call_versions` erhalten. Abgelaufene Calls bleiben ebenfalls in der Historie, sind in der Standardansicht aber ausgeblendet. `verifiedAt`, der letzte Prüfzeitpunkt und die offizielle URL sind Bestandteil der Dashboard-API und werden bei jedem Call angezeigt.

## Versionierte Trend- und Opportunity-Analyse

Die Konfiguration in `lib/radar/config/trend-analysis.v1.ts` versioniert Analyse- und Snapshotformat, Fensterlängen, Mindestfallzahl, Indexierungsreserve, Change-Point-Schwelle und alle vier Opportunity-Komponenten. Jeder Trendlauf schreibt für jeden Scope und jedes Themencluster einen unveränderlichen Datensatz in `theme_signal_snapshots`. Spätere Läufe ergänzen neue Snapshots, statt frühere Messstände zu überschreiben. Die Dashboard-API liest den jüngsten zum Trendlauf gehörenden Snapshot.

Die Methode trennt vier Aussagen ausdrücklich:

- Der beobachtete Publikationstrend vergleicht absolute Publikationszahlen in gleich langen, abgeschlossenen Fenstern.
- Das Emerging Signal kombiniert kurzfristige Veränderung, Preprint-Anteil und einen einfachen Change-Point-Test und bleibt ein exploratives Frühsignal.
- Das Agenda-Signal zählt separat verifizierte aktive Calls. Es beschreibt institutionelle Nachfrage, nicht wissenschaftliche Evidenz.
- Eine mögliche Research Opportunity ist ein transparenter Komponentenscore zur weiteren Prüfung und keine Aussage über künftige Entwicklungen.

Das kurzfristige Fenster umfasst zwei Jahre, das langfristige vier Jahre. Das laufende Kalenderjahr wird immer separat ausgewiesen und nie verglichen. Während der ersten 120 Tage eines neuen Jahres wird zusätzlich das unmittelbar vorangegangene Jahr wegen möglicher Indexierungsverzögerungen ausgeschlossen. Wachstum wird nur berechnet, wenn sowohl das jüngere als auch das gleich lange ältere Fenster mindestens fünf thematische Publikationsdatensätze enthält.

Der normalisierte Wert ist die Zahl thematisch zugeordneter Journal- und Preprint-Datensätze pro 1'000 Journal- und Preprint-Datensätze im scope-spezifischen OpenAlex-Vergleichsfeld. Proceedings bleiben in der absoluten Zahl und als eigener Typ sichtbar, gehen wegen des derzeit verfügbaren Nenners aber nicht in diese Rate ein. Preprint- und Journalmanifestationen eines verknüpften Werks bleiben getrennt zählbar; die Kennzahl beschreibt daher Publikationsdatensätze, nicht zwingend einzigartige Forschungsprojekte.

Der Change-Point-Test vergleicht zwei abgeschlossene Zwei-Jahresfenster mit der einfachen Poisson-Näherung `z = (n_neu - n_alt) / sqrt(n_neu + n_alt)`. Ein Wechsel wird nur bei mindestens fünf Fällen in beiden Fenstern und `|z| >= 1.96` markiert. Dies ist eine reproduzierbare Burst-Heuristik, kein Kausalnachweis. Quellenvielfalt zählt die beteiligten Discovery-Provider; Venue-Diversität wird als auf 0–100 normierte Shannon-Entropie inklusive Anteil des grössten Venues ausgewiesen.

Der Opportunity Score addiert vier einzeln sichtbare Komponenten mit je höchstens 25 Punkten:

- Calls-/Agenda-Signal: fünf Punkte pro aktivem und zusätzlich drei Punkte pro bald schliessendem Call, gedeckelt auf 25.
- Emerging Signal: bis zu 15 Punkte aus dem Preprint-Anteil und bis zu 10 Punkte aus positivem kurzfristigem Wachstum.
- geringe peer-reviewte Sättigung: `25 × (1 - Journalanteil)`.
- strategische Passung: eine versionierte, offen konfigurierte Bewertung der Passung zu Human Factors, Work Design und High-Skill Operations.

Bei unzureichender Mindestfallzahl oder fehlendem Vergleichsnenner wird kein Gesamtscore ausgegeben. Begrenzte Korpus-, Calls- oder Nennerqualität sowie widersprüchliche Signale werden neben den Komponenten angezeigt. Starke Calls bei rückläufiger Publikationsaktivität, ein Emerging Signal ohne Calls und gegenläufige kurz- und langfristige Veränderungen führen explizit zu einem gemischten Befund. Sämtliche Interpretationen werden aus dem aktuellen Snapshot erzeugt; es gibt keine statischen Trendtexte.

## Forschungsworkflow und Korpuszugriff

Die Oberfläche gliedert den Arbeitsablauf in Überblick, Neue Publikationen, Themenlandschaft, Emerging Signals, Calls, Opportunities und Methodik. Der Überblick zeigt zuerst neue deduplizierte Werke aus dem jüngsten erfolgreichen Ingestion Run, die nächsten verifizierten Call-Deadlines, die wichtigsten bereits gespeicherten Emerging Signals sowie Quellenstatus und tatsächliche Datenzeitpunkte. „Neu“ ist damit ausdrücklich kein rollierendes Sieben-Tage-Fenster.

`GET /api/works` durchsucht, filtert, sortiert und paginiert den persistenten D1-Korpus serverseitig. Verfügbar sind Suchschicht, Venue-Art und konkrete Quelle, Thema, Publikationstyp, Kalenderzeitraum sowie exakt gespeicherte OpenAlex Topics als Arbeitsdomänen. Ein Methoden- oder Studientypfilter wird erst aktiviert, wenn dafür strukturierte Metadaten vorliegen; bis dahin zeigt die UI diesen Zustand transparent als nicht verfügbar. Die Sortierung verwendet nur vorhandene Signale: Publikationsdatum, regelbasierte Relevanz, Zitationszahl oder den aktuellen gespeicherten Emerging-Snapshot.

Die reproduzierbare Wochen-Shortlist wird aus den in D1 gespeicherten Erstfundzeitpunkten berechnet. Ihr UTC-Kalenderwochenfenster ist am Endzeitpunkt des jüngsten erfolgreichen Runs verankert, statt bei jedem Aufruf relativ zur aktuellen Uhrzeit zu wandern. Persönlich markierte Werke werden bei authentifizierten Nutzenden über die stabile Plattform-Nutzer-ID in `user_shortlist_items` gespeichert. Nur ohne verfügbare Nutzeridentität fällt die anonyme Ansicht auf lokalen Browser Storage zurück; bei einem Datenbankfehler erfolgt kein stiller Wechsel auf ein anderes Speichermedium.

`GET /api/works/export?format=csv` und `format=bibtex` wenden dieselbe gespeicherte Suche und dieselben Filter an. Ein Export ist auf 5'000 Datensätze begrenzt und weist eine Kürzung über `X-Export-Truncated` aus. Exporte enthalten Provenienz, DOI, Abstract, Themen und Suchschichten; es werden keine synthetischen Einträge ergänzt.

## Methodische Validierung und Audit

Die versionierte Referenzdokumentation liegt in `docs/methodology-1.0.0.md`. `GET /api/radar` liefert dieselben Quellen-, Such-, Klassifikations-, Trend-, Calls-, Qualitäts- und Versionsangaben zusätzlich als maschinenlesbares `methodology`-Objekt.

Die automatische Qualitätskontrolle `data-quality-1.0.0` prüft die jüngsten abgeschlossenen Quellenläufe auf null Treffer, Quellenrückgänge über 50 %, unveränderte Duplikatanteile über 75 %, fehlende Abstracts über 30 %, ein Laufalter über acht Tage sowie partielle und vollständige Quellenausfälle. Warnungen verändern keine Datensätze. Sie erscheinen in der Methodikansicht und in `quality` der Dashboard-API.

`GET /api/audit/export` erzeugt einen Audit-CSV-Export aus real gespeicherten Treffern. Die Spalten `manual_label` und `manual_note` sind absichtlich leer und müssen von Forschenden ausgefüllt werden. Zulässige Labels sind `relevant`, `irrelevant` und `unclear`. Die leere Goldstandard-Struktur und der Freigabeprozess liegen unter `evaluation/`. Precision und Recall bleiben `null`, bis echte Einträge manuell geprüft und versioniert wurden.

## Lokal starten

Voraussetzungen:

- Node.js 22.13 oder neuer
- npm
- eine konfigurierte D1-Bindung `DB`

```bash
npm install
npm run dev
```

Die Drizzle-Schemadefinition liegt in `db/schema.ts`; generierte, versionierte Migrationen liegen unter `drizzle/`. Nach Schemaänderungen wird zuerst die Migration generiert und geprüft:

```bash
npm run db:generate
```

Vor dem ersten Ingestion-Lauf werden alle Drizzle-SQL-Dateien mit Wrangler in Dateireihenfolge auf die lokale D1 angewendet und in `d1_migrations` registriert. Der Befehl baut zuerst das Worker-Paket, verwendet dessen `DB`-Binding und schreibt in denselben lokalen Persistenzordner wie der Vite-Dev-Server:

```bash
npm run db:migrate:local
npm run db:migrations:list:local
```

Der zweite Befehl muss anschliessend `No migrations to apply` melden. Die lokale Platzhalter-ID ist keine Remote-Datenbank-ID und darf nie für eine entfernte Migration verwendet werden.

Bei Sites-Hosting bleibt in `.openai/hosting.json` nur die logische Bindung `DB`; die reale D1-Ressource und entfernte Migration werden über den Sites-Workflow verwaltet. Nach Migrationen sollte die Anwendung zunächst mit leerer Datenbank den ehrlichen Initialisierungszustand anzeigen.

## Laufzeitwerte und Secrets

Keine Zugangsdaten werden in Dateien eingecheckt. Folgende Werte werden ausschliesslich als lokale Prozessumgebung oder als gehostete Secrets gesetzt:

| Name | Erforderlich | Zweck |
| --- | --- | --- |
| `INGESTION_TOKEN` | Ja, für Ingestion | Bearer-Token für `POST /api/ingest` |
| `RADAR_INGESTION_URL` | Ja, für `npm run ingest` | Basis-URL der laufenden Anwendung |
| `OPENALEX_API_KEY` | Nein | Optionaler OpenAlex-Zugang für höhere Limits |
| `CROSSREF_MAILTO` | Nein | Höflicher Kontaktparameter für Crossref |
| `RADAR_INGESTION_SAFETY_LIMIT` | Nein | Globales Limit von 1 bis 25'000 pro Quellenlauf |

Die D1-Bindung `DB` wird von der Laufzeit bereitgestellt und ist kein Secret-String. `.env`, Tokens, API-Schlüssel und Source-Credentials dürfen nicht committed werden.

## Manuelle Ingestion

Die Route `POST /api/ingest` ist durch ein Bearer-Token geschützt. `INGESTION_TOKEN` wird ausschliesslich über die Laufzeit- oder Prozessumgebung gesetzt. `OPENALEX_API_KEY` und `CROSSREF_MAILTO` sind optional und werden ebenfalls nicht in Dateien gespeichert.

Das dokumentierte Sicherheitslimit beträgt standardmässig 5'000 Datensätze pro Quellen-Run. Es kann mit `RADAR_INGESTION_SAFETY_LIMIT` oder mit `safetyLimit` im einzelnen Request auf 1 bis höchstens 25'000 gesetzt werden. Wird das Limit erreicht, endet der Run transparent mit `partial` und `limitReached: true`; es wird kein stillschweigend vollständiger Bestand suggeriert. Für `frontier` gelten getrennte Runs und damit getrennte Limits für OpenAlex und arXiv.

Für einen vollständigen manuellen Lauf setzt der Kommandoaufruf zusätzlich `RADAR_INGESTION_URL` auf die laufende Anwendung:

```bash
npm run ingest
```

Optional kann genau ein Lauf als JSON-Argument gestartet werden, zum Beispiel:

```bash
npm run ingest -- '{"layer":"broad","scope":"ai","safetyLimit":5000}'
```

Calls können für die gesamte Registry oder gezielt für registrierte Quellen eingelesen werden:

```bash
npm run ingest -- '{"dataset":"calls"}'
npm run ingest -- '{"dataset":"calls","sourceKeys":["acm-chi-2027"]}'
```

Eine als `changed` markierte Quelle darf erst nach inhaltlicher Prüfung explizit über dieselbe geschützte Route freigegeben werden:

```bash
npm run ingest -- '{"dataset":"calls","sourceKeys":["acm-chi-2027"],"approveChangedContent":true}'
```

`approveChangedContent` ist keine globale Ausnahme: Es gilt nur für die im Request genannten Registry-Einträge und der Lauf bleibt durch `INGESTION_TOKEN` geschützt.

Zulässig sind `core`, `broad` oder `frontier` mit `ai` oder `field`, `trends` mit `all` sowie `calls` mit optionalen Registry-Schlüsseln. Die älteren Block-2-Aufrufe `publications` und `preprints` bleiben als Kompatibilitätsbrücke erhalten. `npm run ingest` ohne JSON führt alle drei Schichten für beide Scopes, danach die Calls-Ingestion und zuletzt die Trend-Ingestion aus. Dadurch kann der unveränderliche thematische Trendsnapshot das aktuelle verifizierte Agenda-Signal enthalten.

Die Dashboard-API kann bereits ohne UI-Umbau nach Schicht filtern:

```text
GET /api/radar?days=90&scope=ai&layers=core,broad,frontier
```

## Scheduler

Im Repository ist bewusst noch kein Scheduler aktiviert. Eine spätere Cloudflare-Cron-, CI- oder externe Scheduler-Konfiguration ruft ausschliesslich die geschützte Route `POST /api/ingest` mit `Authorization: Bearer <INGESTION_TOKEN>` auf. Der Token gehört in die Secret-Verwaltung des Schedulers und niemals in URL, Payload, Logausgabe oder Repository.

Für einen vollständigen reproduzierbaren Zyklus wird die gleiche Reihenfolge wie im manuellen Befehl verwendet: Core, Broad und Frontier für beide Scopes, danach Calls und zuletzt Trends. So kann der Trendsnapshot die aktuelle, separat gespeicherte Calls-Komponente berücksichtigen. Überlappende Läufe sollten vermieden werden; Status und Warnungen werden anschliessend über Dashboard-API und Methodikansicht kontrolliert.

## Deployment

Vor einem Deployment werden Migrationen geprüft sowie Typprüfung, Lint, Tests und Produktions-Build ausgeführt. Anschliessend werden die logische D1-Bindung und die benötigten Laufzeit-Secrets in Sites konfiguriert, die Migrationen mit dem validierten Build paketiert und eine private Version veröffentlicht. Zugangsdaten, reale Ressourcen-IDs und Schreib-Credentials bleiben ausserhalb des Repositorys.

Dieses Repository darf nicht mit einer leeren oder veralteten entfernten Datenbank als scheinbar vollständiges Dashboard veröffentlicht werden: Nach der Migration muss mindestens ein kontrollierter Ingestion-Lauf durchgeführt und der Quellen- und Qualitätsstatus geprüft werden. In diesem Arbeitsschritt wurde ausdrücklich nicht deployt.

## Datenquelle und Interpretation

Die Ingestion verwendet die öffentlichen APIs von [OpenAlex](https://help.openalex.org/api/), [arXiv](https://info.arxiv.org/help/api/user-manual.html) und – nur zur Anreicherung – [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/). Themencluster, Relevanzscores, datenabgeleitete Forschungsfragen sowie Emerging- und Opportunity-Signale sind transparente, regelbasierte, explorative Signale. Lens Questions sind bewusst vorgegebene theoretische Perspektiven. Keine dieser Darstellungen ersetzt ein systematisches Review oder eine validierte bibliometrische Analyse.

## Qualitätssicherung

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
