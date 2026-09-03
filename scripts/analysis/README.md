# Static corpus analysis

`npm run analyze` classifies the verified files in `site/data/works/` and regenerates
`trends.json`, `questions.json`, the search index, metadata, and one immutable snapshot.
It does not query D1 or the network.

## Versioned methods

- Ontology: `human-work-themes-3.0.0`
- Field-weighted classifier: `weighted-lexical-3.0.0`
- Equal-window trends: `equal-windows-2.0.0`
- Evidence questions: `evidence-questions-2.0.0`
- Opportunity components: `opportunity-components-2.0.0`
- Snapshot contract: `analysis-snapshot-2.0.0`

All versions and the SHA-256 hash of the analyzed input are written to the generated
files. The ontology source is `ontology.v3.mjs`.

## Comparisons and uncertainty

Short comparisons use two adjacent two-year windows. Long comparisons use two
adjacent four-year windows. A theme needs at least five records in both compared
windows. Rates are normalized as theme records per 1,000 eligible corpus records in
the same calendar window.

The current year is excluded. During the first 120 days of a year, the preceding year
is also reserved for indexing lag. Insufficient windows produce `null` metrics and an
`insufficient` status; they never produce a fallback trend or forecast.

Opportunity scores contain four independently visible components: publication
momentum, preprint share, official-call agenda demand, and source diversity. A total is
only emitted when all components are available. The uncertainty object records partial
corpus and source coverage.

Lens questions are part of the declared ontology and carry `framework` status.
Data-derived questions require at least three works with a shared theme pair and link
back to the supporting work IDs and matched evidence terms.
