# Statische Datenverträge

Alle Verträge verwenden JSON Schema Draft 2020-12. Jede ausgelieferte Datei trägt eine fachliche `schemaVersion` im Format `<vertrag>-<major>.<minor>.<patch>`. Eine inkompatible Änderung erhöht `major`; additive optionale Felder erhöhen `minor`; Präzisierungen ohne Vertragsänderung erhöhen `patch`.

| Produktionsdatei | Vertrag | Zweck |
| --- | --- | --- |
| `meta.json` | `meta.schema.json` | Einstiegspunkt, Versionen, Zählwerte, Quellen- und Qualitätsstatus |
| `works/page-*.json` | `works-page.schema.json` + `publication.schema.json` | Paginierte Publikationen und Preprints |
| `search-index.json` | `search-index.schema.json` | Reduzierter, clientseitig durchsuchbarer Index |
| `calls.json` | `calls.schema.json` | Verifizierte Calls und Fristen |
| `trends.json` | `trends.schema.json` | Zeitreihen und belegte Themensignale |
| `questions.json` | `questions.schema.json` | Forschungsfragen mit Evidenzstatus |
| `source-health.json` | `source-health.schema.json` | Quellenverfügbarkeit und Aktualität |
| `snapshots/index.json` | `snapshots-index.schema.json` | Index unveränderlicher historischer Snapshots |
| `snapshots/*.json` | `historical-snapshot.schema.json` | Versionierte historische Aggregate |

`meta.json` ist das Manifest und der Einstiegspunkt. Pfade darin sind relativ zu `site/data/`, beginnen mit `./` und dürfen das Datenverzeichnis nicht verlassen. `works/page-*.json` enthält sowohl Publikationen als auch Preprints; `recordType` unterscheidet beide. Fehlende Quellenwerte werden als `null` oder leere Liste veröffentlicht und niemals synthetisch ergänzt.

Der Dataset-Status ist `ready`, `partial` oder `unavailable`; das Manifest verwendet zusätzlich `empty`, um einen vollständig datenlosen, aber technisch gültigen Stand transparent zu kennzeichnen. Quellenstatus sind `not_checked`, `healthy`, `degraded`, `stale` oder `unavailable`. `stale` bedeutet, dass eine Quelle aktuell nicht verifiziert werden konnte, aber zuvor verifizierte Daten unverändert erhalten wurden. Fachspezifische Statuswerte, etwa für Calls oder Trends, sind in den jeweiligen Schemas geschlossen aufgezählt.

Historische Snapshots sind unveränderliche Aggregate. `snapshots/index.json` listet sie auf; Snapshot-Dateien entsprechen `historical-snapshot.schema.json`. Testdaten liegen ausschließlich unter `tests/fixtures/` und sind kein Bestandteil von `site/data/`.
