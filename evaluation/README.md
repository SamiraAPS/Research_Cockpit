# Goldstandard-Testset

Version: `gold-standard-1.0.0`

## Vorbereitete Pilotprüfung

`pilot-review.csv` enthält 250 nach Publikationstyp, Jahr, Relevanzstatus und Abstract-Verfügbarkeit geschichtete Arbeiten. Die menschlichen Labels sind leer. Die deterministische Aufteilung in `development` und `held-out` verhindert, dass die gesamte Stichprobe zur Anpassung der Regeln verwendet wird. Erst Entwicklungsfälle annotieren und Regeln verbessern; die zurückgehaltenen Fälle erst danach unabhängig auswerten.

`node scripts/prepare-review.mjs site/data evaluation/another-review.csv` erstellt eine neue Stichprobe und überschreibt niemals eine vorhandene Prüfdatei. `node scripts/evaluate-audit.mjs evaluation/reviewed.csv` wertet manuell freigegebene Zeilen und beide Teilmengen getrennt aus. Die Pilotmetriken sind ungewichtet und nicht repräsentativ für den Gesamtkorpus. Für Recall fehlt weiterhin ein unabhängiges Set mit relevanten Nicht-Treffern.

## Öffentliche Pages-Version

Im Bereich „New & Search“ exportiert **Audit-CSV** den gefilterten Bestand samt
Abstracts und vorhergesagten Themen. Die Felder `manual_label`, `manual_themes`,
`work_context`, `population`, `study_design`, `outcomes`, `manual_note`, `reviewer`
und `review_status` bleiben leer. Verwende nach menschlicher Prüfung
`review_status=manually_verified` und eine nachvollziehbare Prüfperson. Für bewusst
keine passenden Themen steht `manual_themes=none`; ein leeres Feld gilt als ungeprüft.

Eine erste Stichprobe sollte Quellen, Jahre und Themen abdecken. Ein Export ist
noch kein Goldstandard. `node scripts/evaluate-audit.mjs reviewed.csv` berechnet
Retrieval-Precision sowie getrennte Themenmetriken aus freigegebenen Zeilen.
Recall bleibt ohne ein unabhängig zusammengestelltes Benchmarkset leer.
Nur dafür darf `--independent-benchmark` verwendet werden; relevante Nicht-Treffer
müssen ebenfalls enthalten und mit `retrieved=false` gekennzeichnet sein.

Die folgenden Angaben dokumentieren zusätzlich den ursprünglichen D1-Prototyp.

Dieses Verzeichnis definiert nur den Vertrag für einen späteren, manuell geprüften Goldstandard. `gold-standard.csv` enthält absichtlich keine Datensätze und keine automatisch erzeugten Labels.

## Manueller Ablauf

1. In der Methodikansicht einen Audit-CSV-Export des real gespeicherten Korpus erzeugen.
2. Jede Zeile anhand von Titel, Abstract, DOI und offizieller Quelle manuell als `relevant`, `irrelevant` oder `unclear` markieren und eine kurze Begründung notieren.
3. Die geprüften Datensätze durch mindestens eine verantwortliche Person freigeben.
4. Nur freigegebene reale Datensätze in `gold-standard.csv` übernehmen. Das Feld `review_status` muss `manually_verified` lauten.
5. Für Recall muss das Kandidatenset auch manuell geprüfte, relevante Nicht-Treffer enthalten; andernfalls darf nur Precision interpretiert werden.

Precision und Recall bleiben in API und UI `null`, solange kein tatsächlich manuell verifizierter Datensatz in der versionierten Goldstandard-Konfiguration vorliegt. Unklare Fälle werden aus den Nennern ausgeschlossen. Die JSON-Struktur ist in `gold-standard.schema.json` dokumentiert.
