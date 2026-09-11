import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, evaluateAudit } from "../../scripts/evaluate-audit.mjs";
import { auditCsv } from "../../site/assets/js/research.js";

test("unreviewed exported candidates do not produce accuracy claims", () => {
  const records = parseCsv(auditCsv([{ id: "w1", title: 'A "quoted", multiline\ntitle', authors: [], classifiedThemes: [] }]));
  assert.equal(records[0].title, 'A "quoted", multiline\ntitle');
  assert.equal(evaluateAudit(records).precision, null);
  assert.equal(evaluateAudit(records).recall, null);
});
test("retrieved-only audit cannot claim recall; independent benchmark can", () => {
  const rows = [
    { review_status: "manually_verified", reviewer: "test reviewer", retrieved: "true", manual_label: "relevant", predicted_themes: "trust;agency", manual_themes: "trust" },
    { review_status: "manually_verified", reviewer: "test reviewer", retrieved: "false", manual_label: "relevant", predicted_themes: "", manual_themes: "trust" }
  ];
  assert.equal(evaluateAudit(rows).recall, null);
  assert.equal(evaluateAudit(rows, { independentBenchmark: true }).recall, 0.5);
  assert.equal(evaluateAudit(rows).perTheme.agency.fp, 1);
});
