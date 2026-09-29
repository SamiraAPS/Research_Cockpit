import { AI_TERMS, HUMAN_FACTORS_TERMS, HUMAN_CONTEXT_TERMS } from "../ingestion/config.mjs";

export const EVIDENCE_VERSION = "research-evidence-1.0.0";
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = term => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/[ -]/g, "[\\s-]+")}s?(?![\\p{L}\\p{N}])`, "iu");

export function termEvidence(work, terms) {
  const evidence = [];
  for (const field of ["title", "abstract"]) {
    const text = String(work[field] ?? "");
    for (const term of terms) {
      const match = pattern(term).exec(text);
      if (!match) continue;
      const start = Math.max(0, match.index - 80), end = Math.min(text.length, match.index + match[0].length + 100);
      evidence.push({ field, term, quote: text.slice(start, end), start, end });
    }
  }
  return evidence;
}

const FIELDS = {
  context: { healthcare: ["healthcare", "clinical", "nursing", "hospital"], education: ["classroom", "education", "student", "university"], operations: ["aviation", "air traffic", "control room", "nuclear", "manufacturing", "industrial", "high stakes", "safety critical"], workplace: ["workplace", "employee", "organizational", "job design", "work design"] },
  population: { students: ["student", "learner"], clinicians: ["nurse", "physician", "clinician", "surgeon"], operators: ["operator", "pilot", "controller"], workers: ["worker", "employee", "professional"], participants: ["participant", "respondent"] },
  aiFunction: { reflection: ["reflection", "reflective", "metacognition"], tutoring: ["tutor", "scaffolding", "feedback"], decisionSupport: ["decision support", "recommendation", "decision aid"], generation: ["generative", "chatbot", "large language model", "ChatGPT", "GenAI"], automation: ["automation", "automated", "cobot", "robot"] },
  outcomes: { motivation: ["intrinsic motivation", "self determination", "meaningful work", "work engagement"], engagement: ["cognitive engagement", "mental effort", "critical thinking"], learning: ["learning outcome", "learning transfer", "skill retention", "knowledge retention", "deskilling", "reflection", "metacognition"], workload: ["cognitive load", "workload", "NASA TLX"], performance: ["task performance", "human performance", "accuracy", "error rate"], autonomy: ["autonomy", "agency", "control"], wellbeing: ["wellbeing", "well being", "burnout", "stress"] },
  studyDesign: { experiment: ["randomized", "randomised", "experiment", "between subjects", "within subjects"], longitudinal: ["longitudinal", "follow up"], qualitative: ["interview", "ethnographic", "qualitative"], survey: ["survey", "questionnaire"], review: ["systematic review", "meta analysis", "scoping review"], simulation: ["simulation study", "simulator"] }
};
const HF_VENUES = /^(Applied Ergonomics|Ergonomics|Human Factors|International Journal of Industrial Ergonomics|Cognition, Technology & Work|Journal of Cognitive Engineering and Decision Making|Work & Stress|Journal of Occupational Health Psychology|New Technology, Work and Employment)$/i;
const HUMAN = [...HUMAN_CONTEXT_TERMS, "people", "person", "patient", "professional", "psychology", "motivation", "metacognition", "reflection", "job", "human computer", "human robot", "human machine"];
const AI = [...AI_TERMS, "AI", "GenAI", "human robot", "algorithmic", "automation", "automated decision"];

export function assessRelevance(work) {
  const human = termEvidence(work, HUMAN);
  const ai = termEvidence(work, AI);
  const domain = termEvidence(work, HUMAN_FACTORS_TERMS);
  const venueMatch = HF_VENUES.test(work.venue ?? "");
  const areas = [];
  if (domain.length || venueMatch) areas.push("human-factors");
  if (ai.length && human.length) areas.push("human-ai");
  const machineOnly = termEvidence(work, ["neural network", "deep learning", "machine learning", "intrusion detection", "image classification", "reinforcement learning", "attention mechanism"]);
  const status = areas.length ? "included" : machineOnly.length && !human.length && work.abstract ? "excluded" : "uncertain";
  return { status, areas, reason: areas.length ? "Hinweise auf menschlichen/arbeitsbezogenen Kontext in Titel, Abstract oder einer Fachzeitschrift." : status === "excluded" ? "Technischer ML-Kontext ohne gefundenen menschlichen Untersuchungsbezug." : "Menschlicher oder arbeitsbezogener Bezug anhand der Metadaten nicht ausreichend bestimmbar.", human: human.slice(0, 4), ai: ai.slice(0, 3), domain: domain.slice(0, 3), venueEvidence: venueMatch ? work.venue : null };
}

export function extractEvidence(work) {
  const relevance = assessRelevance(work);
  const fields = Object.fromEntries(Object.entries(FIELDS).map(([field, values]) => [field, Object.entries(values).flatMap(([value, terms]) => {
    const evidence = termEvidence(work, terms);
    return evidence.length ? [{ value, evidence: evidence.slice(0, 2), interpretation: "mentioned; role/outcome not confirmed" }] : [];
  })]));
  const humanLearning = termEvidence(work, ["student learning", "human learning", "workplace learning", "skill development", "learning outcome", "learning transfer", "reflection", "metacognition", "deskilling"]);
  const machineLearning = termEvidence(work, ["machine learning", "reinforcement learning", "model training", "deep learning"]);
  const learner = humanLearning.length ? machineLearning.length ? "both-mentioned" : "human-mentioned" : machineLearning.length ? "machine-mentioned" : "unknown";
  const personal = [
    ["co-learning", ["co learning", "co-learning", "mutual learning", "human AI learning"]],
    ["motivation", ["intrinsic motivation", "self determination", "meaningful work"]],
    ["cognitive-engagement", ["cognitive engagement", "critical thinking", "metacognition", "reflection"]],
    ["learning-deskilling", ["skill retention", "learning transfer", "deskilling", "cognitive offloading", "workplace learning"]],
    ["high-skill-operations", ["safety critical", "control room", "aviation", "surgeon", "expertise", "high stakes"]]
  ].flatMap(([topic, terms]) => { const evidence = termEvidence(work, terms); return evidence.length ? [{ topic, evidence: evidence.slice(0, 2) }] : []; });
  return { methodVersion: EVIDENCE_VERSION, method: "rules-with-exact-text-spans", validation: "not-human-validated", relevance, learner, fields, personalFit: relevance.status === "excluded" ? [] : personal, finding: null, findingStatus: "requires-reading", abstractAvailable: Boolean(work.abstract) };
}

// Model/manual extractions can only contribute after all quotes have been checked
// against the supplied title/abstract. Unknown is a first-class result.
export function validateExtraction(work, extraction) {
  if (extraction.workId !== work.id || !Array.isArray(extraction.claims)) throw new Error("Invalid extraction identity/claims");
  const allowed = new Set(["population", "context", "aiFunction", "outcomes", "studyDesign", "finding", "limitation"]);
  for (const claim of extraction.claims) {
    if (!allowed.has(claim.field) || !["title", "abstract"].includes(claim.source) || typeof claim.value !== "string" || !claim.value.trim() || typeof claim.quote !== "string" || claim.quote.length < 10 || !String(work[claim.source] ?? "").includes(claim.quote)) throw new Error(`Ungestützte Extraktion für ${work.id}`);
  }
  return { ...extraction, validation: "quotes-checked; interpretation-not-human-validated" };
}
