# Statische Publikations-Ingestion

Die Pipeline läuft direkt unter Node.js und schreibt ausschließlich JSON nach `site/data/`. Sie verwendet keine D1-Verbindung.

- `core`: kuratierte Journals und CHI, CSCW/PACMHCI, IUI, HRI, DIS und HFES über OpenAlex.
- `broad`: disziplinübergreifende OpenAlex-Suche nach KI und menschlicher Arbeit.
- `frontier`: Preprint-Repositorien und frühe Konferenzsignale über OpenAlex sowie arXiv direkt.
- `all`: alle drei Modi; erst ein vollständig erfolgreicher `all`-Lauf wird als kompletter Snapshot markiert.

OpenAlex wird mit `per_page=100` und Cursor-Pagination bis `next_cursor = null` gelesen. arXiv wird über `start` und `max_results` vollständig seitenweise gelesen. Crossref ist ausschließlich ein DOI-Singleton-Enrichment und erzeugt keine eigenen Discovery-Treffer.

Vorhandene Works werden vor jedem Lauf eingelesen. Bei einem Quellenausfall bleiben sie erhalten; betroffene Quellen werden `stale`, der Gesamtdatensatz `partial`. Synthetische Fallbacks werden nicht erzeugt.
