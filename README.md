# Human–AI Research Radar

Öffentliches Dashboard für Human Factors, Ergonomie, Work Design und Psychologie/Human–AI.
Persönliche Perspektive: Co-Learning, intrinsische Motivation, kognitives Engagement,
Lernen/Deskilling und hochqualifizierte Arbeit.

Live: https://samiraaps.github.io/Research_Cockpit/

## Architektur und lokaler Start

Die veröffentlichte HTML/CSS/JavaScript-Anwendung liegt in site/.
Die Node-Pipelines unter scripts/ erzeugen versionierte JSON-Dateien in site/data.
app/, lib/, db/, worker/ und drizzle/ gehören zum getrennten, nicht veröffentlichten
D1-Prototyp. Archiv: [docs/legacy-d1.md](docs/legacy-d1.md).

Voraussetzung: Node.js 24.

    npm ci
    npm run dev

## Aktualisierung

    npm run update:data

Eine vollständige Generation wird in einem separaten Verzeichnis aufgebaut,
analysiert und validiert. Erst danach ersetzt sie den bisherigen Bestand.
Quellenausfälle erhalten Bestandsdaten und werden als Einschränkung ausgewiesen.

GitHub Actions aktualisiert täglich um 05:17 UTC und bei Änderungen an der
Abruflogik. Deployment regeneriert die Analyse passend zur veröffentlichten
Codeversion. OPENALEX_API_KEY gehört in Actions-Secrets bzw. die Prozessumgebung.
CROSSREF_MAILTO ist optional; Crossref dient ausschließlich DOI-Enrichment.

Zwei Forschungsbereiche werden getrennt abgefragt: Human Factors ohne KI-Pflicht
und menschbezogene KI-Forschung. Die persönliche Perspektive priorisiert Treffer;
sie beschränkt den Abruf nicht. Core/Human-Factors erfasst die Fachvenues ohne
KI-Suchbedingung. Broad und Frontier verwenden fachbezogene Suchbegriffe;
Frontier enthält einen direkten arXiv-Abruf und weitere Repositorien über OpenAlex.

Jeder Lauf beginnt mit einem neuen 14-Tage-Fenster. Historische Abrufe (Core ab 2018,
Broad/Frontier ab 2024) und Nachprüfungen der letzten sechs Monate besitzen eigene
Cursor und Budgets. Täglich rotieren zwei Hintergrundspuren. Fünf Seiten je frischem
Abruf und zwei je Hintergrundspur sind Budgets, keine Vollständigkeitsgarantie.
meta.retrievalState dokumentiert die aktuelle Suchversion und Zeitfenster.
Alte Cursor werden nach einer Suchänderung nicht übernommen.

Konferenzfamilien werden monatlich anhand ihrer OpenAlex-Namen ergänzt.
Die Oberfläche zeigt beobachtete Venue-Jahr-Abdeckung; Namensmatches beweisen
keine vollständige Erfassung einer Konferenz.

Eine separate wöchentliche OpenAlex-Jahresaggregation zählt Suchtreffer inklusive
Preprints unabhängig vom Downloadbudget. Diese Zahlen sind **keine validierten
weltweiten Gesamtzahlen aller Psychologie-KI-Publikationen**.

## Trends und Projektideen

Landscape zeigt Jahres- und Monatszahlen einschließlich des laufenden Zeitraums
und Preprints. Absolute Veränderung und relativer Korpusanteil werden getrennt
ausgewiesen. Verglichen werden abgeschlossene Quartale. Ohne Abrufnachweise für
beide Fenster oder bei weniger als fünf Themenarbeiten je Fenster wird keine
belastbare Trendrichtung behauptet. Historische Abdeckung mit der neuen Suchversion
muss erst aufgebaut werden.

Emerging gruppiert Texte und Kontextmerkmale aus allen relevanten Suchmodi.
Ohne Modell nutzt es TF-IDF und Kontextbegriffe; mit optionalen lokalen Embeddings
entstehen getrennt gekennzeichnete semantische Cluster. Gemeinsame Autorenschaften
werden zu Gruppen verbunden. Das ist keine Garantie institutioneller Unabhängigkeit.
Mögliche Titel-/Autorendubletten werden zur Prüfung markiert und nicht ungeprüft gelöscht.

Projektideen trennen Beobachtung, Belege, Fragestellung, Studiendesign,
Gegenargumente und persönliche Passung. Es sind prüfbare, teils vorformulierte
Hypothesen, keine bestätigten Forschungslücken oder Zukunftsprognosen.
Der frühere Opportunity-Gesamtscore ist zurückgezogen. Alte Zwei-/Vierjahresaggregate
bleiben nur zur Kompatibilität historischer Datenverträge erhalten.

## Persönlicher Arbeitsbereich und Ladeverhalten

Shortlist, Lesestand, gespeicherte Suche, Notizen und Projektboard bleiben auf
dem eigenen Gerät. Projektdateien lassen sich als JSON exportieren und importieren.
CSV/BibTeX enthalten den vollständigen gefilterten Bestand.

Ein kompakter Katalog lädt zuerst. Abstract-Shards folgen bei Texteingabe,
Originaldetails beim Öffnen. Datenabrufzeit, letzter vollständig erfolgreicher
Abruf und Analysezeit werden getrennt angezeigt. Ein Seitenaufruf markiert
Literatur nicht automatisch als gelesen.

## Calls

Deadlines zeigen Originaldatum, Quellzeitzone und Schweizer Zeit.
Mehrere Tracks derselben Quelle und desselben Veranstaltungsjahres bilden eine
Agenda-Gruppe. Allgemeine Konferenzaufrufe und nahe Deadlines erzeugen keinen
Neuheitsscore. Thematische Calls ergänzen die Literaturbeobachtung.

config/manual-calls.json ist zunächst leer. Menschlich geprüfte Nachträge bei
blockierten offiziellen Quellen benötigen sourceKey, title, description,
officialUrl, callType, deadlineAt, checkedAt, reviewer und deadlineQuote.
Die Quelle muss in scripts/calls/config.mjs registriert sein; die URL muss auf
einem erlaubten offiziellen Host liegen. Nach acht Tagen gilt der manuelle
Nachweis als veraltet. Eine technische Quellenstörung bleibt sichtbar.

## Optionale lokale KI-Inhaltsanalyse

Die Standardpipeline funktioniert ohne Modell, Kosten oder neue Secrets.
Textregeln speichern exakte Belege und Positionen. Erkannte Studienmerkmale
gelten als Erwähnungen; unbekannte Ergebnisse bleiben leer.

scripts/enrich-semantic.mjs unterstützt einen bereits eingerichteten lokalen
Ollama-Server. RESEARCH_MODEL benennt ein installiertes Chatmodell.
RESEARCH_EMBED_MODEL aktiviert optional Embeddings. Kein Modell wird
automatisch installiert; externe Modellserver werden nicht angesprochen.

    node scripts/enrich-semantic.mjs --limit=20
    node scripts/analyze.mjs

analysis-cache/semantic.json speichert Modellversion, Textfingerprint, Datum und
Originalzitate. Veränderte Texte verwerfen alte Extraktionen; unbelegte Zitate
werden abgelehnt. Ein korrektes Zitat garantiert keine richtige Interpretation.
Ohne eingerichtetes Modell zeigt das Dashboard KI-Abdeckung 0.
Für die Veröffentlichung muss ein geprüfter Cache in den GitHub-Ablauf übernommen
werden. GitHub Pages führt selbst kein Modell aus.

API-Verträge: https://docs.ollama.com/api/chat und https://docs.ollama.com/api/embed

## Wissenschaftliche Prüfung

    node scripts/prepare-review.mjs
    node scripts/evaluate-audit.mjs evaluation/pilot-review.csv
    node scripts/backtest-trends.mjs

Das Pilotset enthält 250 geschichtet ausgewählte Arbeiten mit leeren menschlichen
Bewertungsfeldern. Ein Teil bleibt als held-out-Prüfmenge getrennt. Bestehende
Dateien werden nicht überschrieben. Die ungewichtete Pilot-Precision ist keine
repräsentative Korpus-Precision. Recall benötigt einen unabhängig zusammengestellten
Benchmark mit relevanten Nicht-Treffern; nur dafür gilt --independent-benchmark.

Historische Forecast-Prüfungen benötigen tatsächlich gespeicherte, vergleichbar
abgedeckte Snapshots im Abstand von 90–97 Tagen. Das Werkzeug prüft eine einfache
Persistenzbaseline. Ohne solche Daten bleiben Gütemaße leer. Es erfindet keinen
rückwirkenden damaligen Wissensstand.

## Technische Prüfung

    npm run validate:data
    npm run test:static
    npm run test:browser
    npm test
    npx tsc --noEmit
    npm run lint

Browserprüfungen benötigen Chromium/Chrome/Edge (gegebenenfalls BROWSER_BIN).
Sie prüfen Bedienwege, Mobilansicht und den Accessibility-Baum; sie ersetzen
keinen praktischen Screenreader-Test.

Technisch funktionierende Pipelines sind keine wissenschaftliche Validierung.
Relevanz, Recall, extrahierte Ergebnisse, Neuheit und Prognosegüte benötigen
weiterhin menschliche Prüfung und geeignete historische Daten.
