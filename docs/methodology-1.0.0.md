# Methodik des Human–AI Research Radar

Methodikversion: `methodology-1.0.0`  
Maschinenschema: `radar-methodology-schema-1.0.0`

Diese Dokumentation beschreibt die implementierte, reproduzierbare Pipeline. Das gleich versionierte Maschinenobjekt wird als `methodology` in `GET /api/radar` ausgeliefert.

## Quellen

- OpenAlex dient als Discovery-Quelle für `core`, `broad`, `frontier` und als Vergleichsfeld für Zeitreihen.
- arXiv wird in `frontier` direkt über die offizielle Atom-API abgefragt.
- Crossref ergänzt ausschliesslich DOI-basierte Metadaten. Crossref erzeugt keine zusätzlichen Treffer.
- Calls stammen ausschliesslich aus der versionierten offiziellen Registry von ACM CHI, AHFE, Elsevier/ScienceDirect und SAGE. Nicht registrierte Webquellen werden nicht durchsucht.

Die genaue Venue-Registry liegt in `lib/radar/config/sources.v3.ts`, die Calls-Registry in `lib/calls/config/sources.v1.ts`.

## Suchstrings und Versionen

Die Suchkonfiguration `search-3.0.0` liegt in `lib/radar/config/search.v3.ts`. Jeder Discovery-Treffer speichert Suchschicht und Query-Version:

- `core`: `openalex-core-3.0.0`
- `broad`: `openalex-broad-3.0.0`
- `frontier`: `openalex-arxiv-frontier-3.0.0`
- Vergleichszeitreihen: `openalex-trends-6.0.0`

KI-Begriffe, Human-/Work-Begriffe, Feldbegriffe und arXiv-Kategorien werden direkt aus dieser Datei in das API-Manifest übernommen. OpenAlex verwendet Cursor-Pagination mit 100 Treffern pro Seite. arXiv verwendet paginierte Atom-Abfragen mit 100 Treffern pro Seite. Das Standardsicherheitslimit liegt bei 5'000 Datensätzen pro Quellenlauf und ist maximal auf 25'000 konfigurierbar.

## Ein- und Ausschlusslogik

`core` verlangt eine Venue aus der kuratierten Kernliste. `broad` sucht unabhängig von dieser Liste feldweit. `frontier` umfasst konfigurierte Repositories, Proceedings und die direkte arXiv-Abfrage. Der KI-Scope kombiniert KI-Begriffe mit Human-/Work-Begriffen; der Feld-Scope verwendet die Human-Factors-, Arbeits- und Organisationsbegriffe.

OpenAlex-Datensätze mit `is_retracted:true` werden ausgeschlossen. Datensätze ohne Titel oder stabile Quellen-ID werden nicht gespeichert. Preprint- und Journalmanifestationen werden über DOI, OpenAlex-ID, Quell-ID, normalisierten Titel und vorsichtige Titelähnlichkeit verknüpft, bleiben aber als Fassungen erhalten.

## Themenklassifikation

Die Ontologie `human-work-themes-2.0.0` und Klassifikation `weighted-lexical-2.0.0` verwenden normalisierte vollständige Wörter und Phrasen in Titel, Abstract, Keywords und OpenAlex Topics. Titelbegriffe zählen vier Punkte, Keywords drei, OpenAlex Topics zwei und Abstractbegriffe einen Punkt. Ab zwei Punkten wird ein Thema zugeordnet. Auslösende Begriffe und Felder werden gespeichert. Rohhäufigkeiten sind wegen unterschiedlich breiter Vokabulare kein Themenranking.

## Trend- und Opportunity-Berechnung

Die Version `trend-opportunity-1.0.0` vergleicht nur gleich lange abgeschlossene Fenster: zwei Jahre kurzfristig und vier Jahre langfristig. Das laufende Jahr ist ausgeschlossen; während der dokumentierten 120-Tage-Indexierungsreserve kann zusätzlich das letzte abgeschlossene Jahr ausgeschlossen werden. Unter fünf thematischen Publikationsdatensätzen pro Vergleichsfenster wird kein Trend behauptet.

Der Change-Point-Test verwendet `z = (n_neu - n_alt) / sqrt(n_neu + n_alt)` und markiert erst ab `|z| >= 1.96`. Der Opportunity Score addiert vier sichtbare Komponenten: Calls-/Agenda-Signal, Emerging Signal, geringe peer-reviewte Sättigung und strategische Passung. Er ist ein exploratives Prüfsignal, keine Prognose.

## Calls-Interpretation

Calls zeigen institutionelle Nachfrage und Agenda-Setzung. Sie sind weder wissenschaftliche Evidenz noch ein Beleg für künftige Publikationsmengen. Abgelaufene Calls bleiben historisch gespeichert, sind standardmässig aber ausgeblendet. Parseränderungen, nicht verifizierte Inhalte und Quellenausfälle werden zur manuellen Prüfung markiert.

## Automatische Datenqualitätskontrolle

Die Version `data-quality-1.0.0` prüft die jeweils jüngsten abgeschlossenen Ingestion Runs. Warnungen entstehen bei null Treffern, einem Rückgang um mehr als 50 Prozent gegenüber dem vorherigen vergleichbaren Lauf, mehr als 75 Prozent unveränderten Duplikaten, mehr als 30 Prozent fehlenden Abstracts, einem Alter von mehr als acht Tagen sowie partiellen oder vollständigen Quellenausfällen. Läufe am Sicherheitslimit werden nicht für die Rückgangswarnung verglichen.

Warnungen verändern keine Daten und lösen keine automatische Korrektur aus. Sie sind reproduzierbare Hinweise für einen manuellen Audit.

## Goldstandard, Precision und Recall

`evaluation/` enthält einen leeren, versionierten Goldstandard-Vertrag. Der Audit-CSV-Export enthält reale gespeicherte Treffer und leere Spalten für `manual_label` und `manual_note`. Es werden keine Labels erzeugt. Precision und Recall bleiben `null`, bis reale Datensätze manuell geprüft und versioniert wurden. Recall ist nur interpretierbar, wenn das Goldstandard-Kandidatenset auch relevante Nicht-Treffer umfasst.

## Bekannte Grenzen

- Quellenindizes können verzögert oder unvollständig sein.
- OpenAlex Topics sind maschinell abgeleitet.
- Suchstrings und Ontologien bilden Begriffe unterschiedlich breit ab.
- Verknüpfte Manifestationen können in publikationsbezogenen Kennzahlen separat erscheinen.
- Quellenrückgang, Duplikatanteil und Abstractabdeckung sind Warnschwellen, keine Beweise für einen Datenfehler.
- Ohne manuell geprüften Goldstandard gibt es keine empirische Precision-/Recall-Aussage.
