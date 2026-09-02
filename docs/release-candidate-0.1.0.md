# Release Candidate 0.1.0

Prüfdatum: 31. August 2026  
Status: lokal und fixture-basiert validiert, nicht deployt

## Ergebnis

Der Release-Kandidat ist technisch konsistent. Schema, vollständiger reproduzierbarer Ingestion-Ablauf, Statuslogik, Analysen, UI-Verträge, Dokumentation und Produktions-Build sind geprüft. Eine Veröffentlichung ist noch nicht freigegeben, weil in diesem Arbeitsverzeichnis keine reale D1-Bindung, keine Ingestion-Laufzeitwerte und keine Sites-Projektverknüpfung vorhanden sind. Ein echter vollständiger Remote-Ingestion-Lauf wurde deshalb bewusst nicht gestartet.

## Geprüfte Punkte

| Bereich | Ergebnis |
| --- | --- |
| Datenbankmigrationen | Sieben SQL-Migrationen (`0000` bis `0006`) werden in Reihenfolge auf eine leere SQLite-/D1-kompatible Testdatenbank angewendet. `drizzle-kit check`, `PRAGMA integrity_check` und `PRAGMA foreign_key_check` sind erfolgreich. |
| Vollständiger Ingestion Run | Core, Broad und Frontier für `ai` und `field`, direkte arXiv-Erfassung, alle registrierten Calls-Adapter und vier Trendserien laufen mit gespeicherten Fixtures vollständig durch. Ein echter Lauf ist mangels D1-Bindung, URL und Token nicht ausführbar. |
| Quellenstatus | OpenAlex, arXiv, CHI und AHFE waren am Prüfdatum per HTTP erreichbar. ScienceDirect und SAGE antworteten aus der Prüfumgebung mit HTTP 403; die Anwendung behandelt solche Quellen ohne Ersatzdaten als nicht verfügbar beziehungsweise nicht verifiziert. |
| Pagination | OpenAlex-Cursor über zwei gespeicherte Seiten sowie arXiv-Seitenparameter und Parser sind getestet. Das Sicherheitslimit beendet unvollständige Läufe transparent als `partial`. |
| Calls-Aktualität | Die versionierte Registry verweist auf offizielle 2027-Seiten. Ablauf, Sortierung, Inhaltsänderung, Parserfehler, Quellenausfall und unverifizierte Historie sind getestet. |
| Produktionsdaten | Repository-Hygienetests finden keine eingebetteten Produktions-Fallbacks, synthetischen Calls, Environment-Dateien oder Zugangsdaten. Fixtures liegen ausschliesslich unter `tests/fixtures`. |
| Trend und Opportunity | Gleich lange Fenster, laufendes Jahr, Indexierungsreserve, Mindestfallzahl, normalisierte Raten, Diversität, Change-Point, getrennte Signale und sichtbare Opportunity-Komponenten sind mit kontrollierten Daten getestet. |
| Datenschutz und Secrets | Die Ingestion-Route verlangt einen Laufzeit-Token und vergleicht dessen Hash in konstanter Schleife. Nutzerbezogene Shortlists verwenden nur die Plattform-Nutzer-ID; ohne Identität wird der anonyme Browser-Speicher transparent ausgewiesen. Im Repository wurden keine Secrets gefunden. |
| Mobile und Accessibility | Responsive Breakpoints, Reduced Motion, zugängliche Namen, Live-/Alert-States, Statusrollen, Tastatur-fähige Standardcontrols und gerendertes Navigationsmarkup sind automatisiert geprüft. Der lokale Server lieferte HTTP 200. Eine echte visuelle Viewport-/Screenreader-Prüfung war wegen einer fehlerhaften Vertrauenskonfiguration des Browser-Plugins nicht möglich. |
| README und Methodik | Lokale Einrichtung, Migration, Ingestion, Scheduler, Secrets, Deployment, Quellen, Suchstrings, Klassifikation, Trends, Calls und bekannte Grenzen sind dokumentiert; das Methodikobjekt ist maschinenlesbar in der API. |

## Implementierte Fähigkeiten

- Ehrliche, getrennte Datenstatus und Aktualitätsangaben ohne synthetische Produktionsdaten.
- Persistente D1-Datenhaltung mit Ingestion Runs, Quellenzustand, Werkversionen, Deduplizierung und historischen Snapshots.
- Versionierte Core-, Broad- und Frontier-Suche mit OpenAlex-Cursor-Pagination, direkter arXiv-Abfrage und kontrollierter Crossref-Anreicherung.
- Offizielle Calls-Registry mit quellenspezifischen Adaptern, Verifikation, unveränderlicher Historie und separatem Agenda-Signal.
- Evidenzgebundene Themenklassifikation und getrennte theoretische sowie datenabgeleitete Forschungsfragen.
- Transparente Trend-, Emerging-, Agenda- und Opportunity-Analyse mit Mindestfallzahlen und Qualitätsstatus.
- Forschungsworkflow mit serverseitiger Suche, Pagination, Filtern, Sortierung, Shortlist, Wochenansicht sowie CSV-/BibTeX-Export.
- Automatische Qualitätswarnungen, Audit-CSV, Goldstandard-Struktur und versionierte maschinenlesbare Methodik.
- Responsive und semantisch zugängliche Status-, Fehler-, Leer- und Ladezustände.

## Verbleibende methodische Grenzen

- OpenAlex und arXiv können verzögert, unvollständig oder unterschiedlich indexiert sein.
- Die kuratierten Quellen- und Suchkonfigurationen benötigen fortlaufende fachliche Pflege.
- OpenAlex Topics sind maschinell abgeleitet; Ontologien besitzen unterschiedlich breite Vokabulare.
- Verknüpfte Preprint- und Journalmanifestationen bleiben absichtlich separat sichtbar und können in publikationsbezogenen Kennzahlen mehrfach vorkommen.
- Calls zeigen institutionelle Nachfrage, nicht wissenschaftliche Evidenz; Bot-Schutz kann ihre zeitnahe automatische Verifikation verhindern.
- Burst-/Change-Point- und Opportunity-Signale sind explorative Heuristiken, keine Prognosen oder Kausalnachweise.
- Precision und Recall bleiben ohne manuell gelabelten Goldstandard undefiniert.
- Methode beziehungsweise Studientyp ist noch nicht als verlässliche strukturierte Metadatenquelle verfügbar.
- Die D1-`LIKE`-Suche ist für einen moderaten Korpus geeignet; für sehr grosse Bestände ist die Skalierung noch nicht praktisch validiert.

## Laufzeitwerte und manuelle Konfiguration

| Name | Status | Verwendung |
| --- | --- | --- |
| D1-Bindung `DB` | erforderlich | Persistente Laufzeitdatenbank; kein Secret-String. |
| `INGESTION_TOKEN` | erforderlich für Ingestion | Bearer-Secret der geschützten Route. |
| `RADAR_INGESTION_URL` | erforderlich für CLI-Ingestion | Basis-URL der laufenden Anwendung. |
| `OPENALEX_API_KEY` | optional | Höhere beziehungsweise stabilere OpenAlex-Limits. |
| `CROSSREF_MAILTO` | optional | Höflicher Kontaktparameter für Metadatenanreicherung. |
| `RADAR_INGESTION_SAFETY_LIMIT` | optional | Globales Limit zwischen 1 und 25'000 Treffern pro Quellenlauf. |

Vor einer Veröffentlichung sind manuell erforderlich:

1. Das Sites-Projekt verknüpfen; `.openai/hosting.json` enthält derzeit keine `project_id`.
2. Eine D1-Ressource an `DB` binden und die Migrationen `0000` bis `0006` in Reihenfolge anwenden.
3. `INGESTION_TOKEN` und bei CLI-Nutzung `RADAR_INGESTION_URL` ausschliesslich in der Laufzeit-/Secret-Verwaltung setzen.
4. `npm run ingest` gegen die migrierte Zielumgebung vollständig ausführen.
5. Quellenstatus, Calls-Verifikation, Qualitätswarnungen, Datensatzanzahlen und neuesten Snapshot manuell prüfen.
6. Mobile Viewports, Tastaturfluss und Screenreader in einem funktionsfähigen Browser nochmals praktisch prüfen.
7. Erst nach expliziter Veröffentlichungsfreigabe den geprüften Build paketieren und als private Sites-Version veröffentlichen; die Website-Zugriffsrechte dabei unverändert lassen.

## Qualitätsnachweis

- `npx drizzle-kit check`: erfolgreich
- `npm test`: 51 von 51 Tests erfolgreich; enthält einen Produktions-Build
- `npm run lint`: erfolgreich
- `npx tsc --noEmit`: erfolgreich
- `npm run build`: erfolgreich
- Nicht blockierende Warnung: der minifizierte Client-Chunk `radar-dashboard` ist ungefähr 557 kB gross.

## Versionskontrolle

In diesem Arbeitsverzeichnis und seinem direkten Elternverzeichnis fehlt `.git`. Ein fokussierter Commit oder Pull Request kann deshalb hier nicht erzeugt werden, ohne stillschweigend eine neue Historie anzulegen. Die Git-Metadaten des bestehenden Branches müssen zuerst wiederhergestellt oder das geprüfte Arbeitsverzeichnis in den tatsächlichen Checkout übernommen werden.
