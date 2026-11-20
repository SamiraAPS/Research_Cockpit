import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { textFingerprint, workText } from "../similarity/rank.mjs";

// Full abstracts are published only for works that are open access (arXiv
// preprints included). For all other works the published data keeps a short
// excerpt; the full text is neither stored in the repository nor shown.
export const ABSTRACT_POLICY_VERSION = "abstract-policy-1.0.0";
export const EXCERPT_LENGTH = 300;

export function abstractExcerpt(abstract, limit = EXCERPT_LENGTH) {
  const text = String(abstract ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit + 1);
  const end = cut.lastIndexOf(" ");
  return `${cut.slice(0, end > limit * 0.6 ? end : limit).replace(/[\s,;:–-]+$/, "")} …`;
}

/**
 * Returns the work as it may be published. A restricted work keeps the
 * fingerprint of its full text, so the ranking computed from the full text
 * stays valid without the text being kept.
 */
export function restrictAbstract(work) {
  // Nothing to shorten, free to publish, or already an excerpt.
  if (!work.abstract || work.openAccess === true || work.abstractRestricted) return work;
  return { ...work, abstract: abstractExcerpt(work.abstract), abstractRestricted: true, abstractDigest: textFingerprint(workText(work)) };
}

/**
 * Markers for a rebuilt work: they stay only while the abstract is still the
 * stored excerpt. If a fetch brought the full text back, the policy is applied anew.
 */
export function restrictionMarkers(existingWorks, abstract) {
  const stored = existingWorks.find(work => work?.abstractRestricted && work.abstract === abstract);
  return stored ? { abstractRestricted: true, abstractDigest: stored.abstractDigest } : {};
}

/** Applies the policy to every works page of a data directory. */
export async function restrictAbstracts(dataDirectory) {
  const directory = path.join(dataDirectory, "works");
  const names = (await readdir(directory)).filter(name => /^page-\d+\.json$/.test(name)).sort();
  let restricted = 0, changed = 0, total = 0;
  for (const name of names) {
    const file = path.join(directory, name);
    const page = JSON.parse(await readFile(file, "utf8"));
    let dirty = false;
    page.items = page.items.map((work) => {
      const next = restrictAbstract(work);
      total += 1;
      if (next.abstractRestricted) restricted += 1;
      if (next !== work) { dirty = true; changed += 1; }
      return next;
    });
    if (!dirty) continue;
    await writeFile(`${file}.tmp`, JSON.stringify(page));
    await rename(`${file}.tmp`, file);
  }
  return { policyVersion: ABSTRACT_POLICY_VERSION, totalWorks: total, restrictedWorks: restricted, changedThisRun: changed };
}
