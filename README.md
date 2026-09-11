# Human–AI Research Radar

Öffentliches Forschungsdashboard für **Psychologie und Human–AI Interaction**:
Publikationen finden, Themenverbindungen prüfen und offizielle Deadlines verfolgen.

Live: https://samiraaps.github.io/Research_Cockpit/

## Verbindliche Architektur

Die veröffentlichte Anwendung ist `site/`. `npm run dev` startet diese Oberfläche.
Die Node-Pipelines in `scripts/ingestion/`, `scripts/calls/` und `scripts/analysis/`
erzeugen versionierte JSON-Daten. Die Oberfläche berechnet keine eigenen Trend-
oder Opportunity-Scores. Plattformunabhängige Regeln werden über
`site/assets/js/research.js` zwischen Pipeline und Browser geteilt.

`app/`, `lib/`, `db/`, `worker/` und `drizzle/` gehören zum getrennten D1-Prototyp.
Sie werden nicht auf Pages veröffentlicht. Dessen Authentifizierung und serverseitige
Shortlists sind hier nicht aktiv. `npm run dev:legacy` startet den Prototyp.
Die ursprüngliche Dokumentation steht als Archiv in `docs/legacy-d1.md`.
Neue Produktfunktionen werden ausschließlich in der statischen Anwendung entwickelt.

## Aktualisierung und historische Abdeckung

Voraussetzung: Node.js 24 und `npm ci`.

```sh
npm run update:data
```

Der Ablauf lädt Publikationen und Calls, analysiert und validiert eine separate
Datengeneration und ersetzt erst danach den bisherigen Bestand. Quellenausfälle
erhalten gespeicherte Werke und werden als Einschränkung sichtbar ausgewiesen.

`Refresh research data` läuft täglich um 05:17 UTC und kann manuell gestartet werden.
Die Action committet ausschließlich validierte Daten und veröffentlicht exakt diesen
Commit über den Deploymentworkflow. Technischer Erfolg bedeutet keine vollständige
fachliche Abdeckung.

`OPENALEX_API_KEY` gehört in die GitHub-Actions-Secrets oder lokale Prozessumgebung.
Ohne Schlüssel ist nur ein kleines anonymes Tagesbudget verfügbar. Optional:
`CROSSREF_MAILTO`. Crossref ist ausschließlich DOI-Enrichment, keine Discovery-Quelle;
der regelmäßige Ablauf lässt das zusätzliche Enrichment standardmäßig aus.

Ein unterbrochener historischer Core-Abruf ab 2018 wird zuerst fortgesetzt.
`meta.historicalBackfill` hält diesen Zustand fest. Danach werden Core, Broad und
Frontier einschließlich arXiv über 90 Tage aktualisiert. Pro Quelle werden fünf
Seiten verarbeitet; Cursor/Offset und Datumsfenster bleiben für die Fortsetzung in
`meta.ingestionProgress` erhalten. Begrenzte oder fehlgeschlagene Abrufe sind `partial`.

```sh
node scripts/update-data.mjs --mode=core --from=2018-01-01 --to=2025-12-31 --max-pages=20
```

Die Methodikansicht zeigt tatsächliche Jahresabdeckung, Quellenzustand und offene
Fortsetzungen. Eine erneute Analyse ersetzt keinen fehlenden historischen Abruf.

## Interpretation und Forschungsworkflow

Trends vergleichen angrenzende Zwei- und Vier-Jahresfenster im **Core-Korpus**.
Das laufende Jahr bleibt ausgeschlossen; zu Jahresbeginn gilt die Indexierungsreserve.
Mindestens fünf Themenarbeiten müssen in jedem Vergleichsfenster liegen.
Die Rate beschreibt Themenarbeiten je 1.000 Core-Arbeiten, keinen Anteil am gesamten
Forschungsfeld. Broad/Frontier erweitern die Recherche, werden aber nicht mit einer
anders erhobenen historischen Core-Basis vermischt. Bei unvollständigem
Vergleichskorpus wird kein Opportunity-Gesamtscore ausgegeben.

Die persönliche Perspektive „Psychologie & Human–AI Interaction“ ist eine
Interessenfestlegung, kein Evidenzmaß. Automatische Fragen beschreiben beobachtete
Themenverbindungen; sie belegen weder Mechanismen noch Forschungslücken. Die
zugehörigen Arbeiten sind zur Inhaltsprüfung direkt verlinkt.

„Letzter Lauf“ verwendet Erstfund-Run-IDs. „Seit letztem Lesestand“ verwendet den
explizit gespeicherten Lesestand; Aufrufen markiert nichts automatisch als gelesen.
Die Laufwoche ist eine feste UTC-Kalenderwoche. Publikationsaktualität ist ein eigener
30-Tage-Filter. Shortlist, Suche und Lesestand werden nur auf dem eigenen Gerät gespeichert.
CSV/BibTeX exportieren den vollständigen gefilterten Bestand. Der Suchindex lädt zuerst;
vollständige Publikationsdetails werden erst beim Öffnen abgerufen.

Call-Deadlines zeigen Originaldatum, Uhrzeit und Quellzeitzone sowie Schweizer Ortszeit.
Der aktuelle Zeitstatus bleibt vom Zeitpunkt der letzten Quellenprüfung getrennt.

## Fachliche Prüfung

Der Audit-Export enthält leere Felder für Relevanz, Themen, Arbeitskontext, Population,
Studiendesign, Outcomes und menschliche Freigabe. Es werden keine Labels erfunden.

```sh
node scripts/evaluate-audit.mjs reviewed.csv
# Nur mit unabhängig zusammengestelltem Benchmarkset:
node scripts/evaluate-audit.mjs benchmark.csv --independent-benchmark
```

Eine Stichprobe aus Suchtreffern liefert keine Recall-Schätzung. Details stehen in
`evaluation/README.md`.

## Prüfung und Veröffentlichung

```sh
npm run validate:data
npm run test:static
npm run test:browser
npm test
npx tsc --noEmit
npm run lint
```

Die Browsertests verwenden vorhandenes Chromium/Edge mit isoliertem Testprofil
(`BROWSER_BIN` bei Bedarf). Sie prüfen Suche, Shortlist, Wiederladen, gespeicherte
Suche, Details, Export, Lesestand, Direktlinks, Deadlines und mobile Darstellung.

`Deploy GitHub Pages` veröffentlicht nur `site/`. Berechtigungen: `contents: read`,
`pages: read` beim Konfigurieren, `pages: write` und `id-token: write` beim Deployment.
Das Repository ist öffentlich. Der D1-Build bleibt als Regressionstest erhalten.
