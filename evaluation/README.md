# Goldstandard-Testset

Version: `gold-standard-1.0.0`

Dieses Verzeichnis definiert nur den Vertrag für einen späteren, manuell geprüften Goldstandard. `gold-standard.csv` enthält absichtlich keine Datensätze und keine automatisch erzeugten Labels.

## Manueller Ablauf

1. In der Methodikansicht einen Audit-CSV-Export des real gespeicherten Korpus erzeugen.
2. Jede Zeile anhand von Titel, Abstract, DOI und offizieller Quelle manuell als `relevant`, `irrelevant` oder `unclear` markieren und eine kurze Begründung notieren.
3. Die geprüften Datensätze durch mindestens eine verantwortliche Person freigeben.
4. Nur freigegebene reale Datensätze in `gold-standard.csv` übernehmen. Das Feld `review_status` muss `manually_verified` lauten.
5. Für Recall muss das Kandidatenset auch manuell geprüfte, relevante Nicht-Treffer enthalten; andernfalls darf nur Precision interpretiert werden.

Precision und Recall bleiben in API und UI `null`, solange kein tatsächlich manuell verifizierter Datensatz in der versionierten Goldstandard-Konfiguration vorliegt. Unklare Fälle werden aus den Nennern ausgeschlossen. Die JSON-Struktur ist in `gold-standard.schema.json` dokumentiert.
