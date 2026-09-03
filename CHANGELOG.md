# Changelog

Alle wesentlichen Aenderungen dieses Projekts werden in dieser Datei dokumentiert.

## [Unreleased]

- GitHub-Pages-Workflow mit vollständiger Validierung und manueller Auslösung ergänzt.
- Statisches Dashboard zeigt den Zeitpunkt der letzten erfolgreichen Ingestion ausdrücklich und ohne Ersatz durch den Exportzeitpunkt.

## [0.1.0] - 2026-08-31

Der detaillierte Prüfstand ist im [Release-Candidate-Bericht](docs/release-candidate-0.1.0.md) festgehalten.

### Hinzugefuegt

- Transparente, getrennte Datenstatus fuer Publikationen, Preprints, Trends und Calls ohne synthetische Produktionsdaten.
- Persistente Cloudflare-D1-Datenhaltung mit Drizzle-Migrationen, versionierten Werkfassungen, Deduplizierung, Quellenstatus und historischen Snapshots.
- Versionierte Suchschichten Core, Broad und Frontier mit OpenAlex-Cursor-Pagination, direkter arXiv-Abfrage und optionaler Crossref-Anreicherung.
- Offizielle, adapterbasierte Calls-Erfassung mit Historie, Verifikationsstatus und separatem Agenda-Signal.
- Versionierte, evidenzgebundene Themenklassifikation und getrennte theoretische sowie datenabgeleitete Forschungsfragen.
- Nachvollziehbare Trend-, Emerging-, Agenda- und Opportunity-Signale mit Mindestfallzahlen, Datenqualitaet und sichtbaren Score-Komponenten.
- Forschungsworkflow mit serverseitiger Korpussuche, Pagination, Filtern, Shortlist, CSV-/BibTeX-Export und reproduzierbarer Wochenansicht.
- Automatische Plausibilitaetswarnungen, Audit-CSV, leere Goldstandard-Struktur und maschinenlesbares Methodikobjekt.

### Release-Pruefung

- Alle sieben Drizzle-Migrationen werden in den Datenbanktests in Reihenfolge angewendet; Schema- und Integritaetspruefungen sind Bestandteil des Release-Kandidaten.
- Der vollstaendige Ingestion-Ablauf wird mit gespeicherten OpenAlex-, arXiv- und offiziellen Calls-Fixtures reproduzierbar getestet.
- Der Release-Kandidat wurde nicht veroeffentlicht oder deployt.

### Bekannte Einschraenkungen

- Ein realer vollstaendiger Ingestion-Lauf benoetigt eine gebundene und migrierte D1-Datenbank sowie Laufzeit-Secrets und wurde ohne diese Konfiguration nicht ausgefuehrt.
- Precision und Recall bleiben bis zu einer echten manuellen Goldstandard-Annotation undefiniert.
- Calls-Quellen koennen durch Publisher-Bot-Schutz voruebergehend nicht automatisiert verifiziert werden und werden dann nicht als aktuelle verifizierte Calls ausgegeben.
