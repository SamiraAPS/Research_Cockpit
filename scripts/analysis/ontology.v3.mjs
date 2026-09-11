export const ONTOLOGY_VERSION = "human-work-themes-3.0.0";
export const CLASSIFICATION_VERSION = "weighted-lexical-3.0.0";
export const ANALYSIS_VERSION = "static-corpus-analysis-2.1.0";
export const TREND_METHOD_VERSION = "equal-windows-2.1.0";
export const QUESTION_METHOD_VERSION = "evidence-questions-2.1.0";
export const OPPORTUNITY_METHOD_VERSION = "opportunity-components-2.1.0";
export const SNAPSHOT_VERSION = "analysis-snapshot-2.0.0";

export const FIELD_WEIGHTS = Object.freeze({
  title: 4,
  abstract: 1,
  keyword: 3,
  external_topic: 2
});

export const CLASSIFICATION_THRESHOLD = 2;
export const MINIMUM_EVIDENCE_RECORDS = 3;
export const MINIMUM_TREND_RECORDS = 5;
export const SHORT_WINDOW_YEARS = 2;
export const LONG_WINDOW_YEARS = 4;
export const INDEXING_LAG_DAYS = 120;

export const THEMES = Object.freeze([
  {
    id: "learning",
    label: "Lernen & Deskilling",
    shortLabel: "Lernen",
    rationale: "Lernen, Kompetenzentwicklung, Expertiseerhalt und kognitive Auslagerung.",
    lensQuestion: "Wie kann KI menschliche Lernschleifen und Expertiseerhalt unterstützen, ohne schleichendes Deskilling zu fördern?",
    excludedPhrases: ["machine learning", "deep learning", "reinforcement learning", "representation learning", "federated learning"],
    concepts: [
      { id: "learning", label: "Lernen", terms: ["learning", "learner", "learners", "workplace learning", "learning process", "learning outcome"] },
      { id: "deskilling", label: "Deskilling", terms: ["deskilling", "de-skilling", "skill degradation", "skill loss", "skill erosion"] },
      { id: "expertise", label: "Expertise", terms: ["expertise", "expert performance", "skill retention", "knowledge retention"] },
      { id: "development", label: "Kompetenzentwicklung", terms: ["skill development", "competence development", "upskilling", "reskilling", "scaffolding"] },
      { id: "offloading", label: "Kognitive Auslagerung", terms: ["cognitive offloading", "cognitive dependency", "automation dependency"] }
    ]
  },
  {
    id: "trust",
    label: "Vertrauen & Reliance",
    shortLabel: "Vertrauen",
    rationale: "Kalibriertes Vertrauen, angemessene Nutzung und kritische Prüfung von KI.",
    lensQuestion: "Wann führt Transparenz zu kalibriertem Vertrauen und wann nur zu höherem subjektivem Sicherheitsgefühl?",
    concepts: [
      { id: "trust", label: "Vertrauen", terms: ["trust", "trusted", "trusting", "trustworthy", "trustworthiness"] },
      { id: "reliance", label: "Reliance", terms: ["reliance", "rely", "relying", "overreliance", "over-reliance", "underreliance", "under-reliance"] },
      { id: "calibration", label: "Kalibrierung", terms: ["calibration", "calibrated trust", "trust calibration", "appropriate reliance"] },
      { id: "automation-bias", label: "Automation Bias", terms: ["automation bias", "algorithm aversion", "algorithm appreciation"] },
      { id: "explainability", label: "Erklärbarkeit", terms: ["explainability", "explainable ai", "transparency", "transparent ai"] }
    ]
  },
  {
    id: "agency",
    label: "Work Design & Agency",
    shortLabel: "Agency",
    rationale: "Autonomie, Arbeitsgestaltung, sinnvolle Arbeit und algorithmisches Management.",
    lensQuestion: "Wie verändern KI-Systeme Autonomie, Rollensignifikanz und Aufgabenidentität in hochqualifizierter Arbeit?",
    concepts: [
      { id: "work-design", label: "Arbeitsgestaltung", terms: ["work design", "job design", "task design", "work redesign", "job redesign"] },
      { id: "agency", label: "Agency", terms: ["agency", "human agency", "worker agency", "agentic"] },
      { id: "autonomy", label: "Autonomie", terms: ["autonomy", "autonomous work", "job autonomy", "task autonomy"] },
      { id: "meaning", label: "Sinnvolle Arbeit", terms: ["meaningful work", "meaning of work", "work meaningfulness", "task significance", "role significance", "task identity"] },
      { id: "management", label: "Algorithmisches Management", terms: ["algorithmic management", "algorithmic control", "worker control", "digital labor control"] }
    ]
  },
  {
    id: "cognition",
    label: "Kognitive Arbeit",
    shortLabel: "Kognition",
    rationale: "Kognitive Belastung, Situation Awareness, Aufmerksamkeit und Entscheidungsqualität.",
    lensQuestion: "Welche adaptive Unterstützung entlastet, ohne Wahrnehmung, Verständnis und Projektion zu unterminieren?",
    concepts: [
      { id: "load", label: "Kognitive Belastung", terms: ["cognitive load", "mental workload", "cognitive workload", "workload"] },
      { id: "awareness", label: "Situation Awareness", terms: ["situation awareness", "situational awareness"] },
      { id: "attention", label: "Aufmerksamkeit", terms: ["attention", "attentional", "vigilance"] },
      { id: "decision", label: "Entscheiden", terms: ["decision making", "decision-making", "decision support", "decision quality"] },
      { id: "sensemaking", label: "Sensemaking", terms: ["sensemaking", "sense-making", "mental model", "mental models", "cognitive readiness"] }
    ]
  },
  {
    id: "teaming",
    label: "Human–AI Teaming",
    shortLabel: "Teaming",
    rationale: "Komplementäre Zusammenarbeit und Interaktion zwischen Menschen und intelligenten Systemen.",
    lensQuestion: "Welche Interaktionsmuster ermöglichen Co-Learning statt einseitiger Delegation und einseitigem Modelllernen?",
    concepts: [
      { id: "collaboration", label: "Mensch–KI-Kollaboration", terms: ["human ai collaboration", "human-ai collaboration", "human machine collaboration", "human-machine collaboration"] },
      { id: "interaction", label: "Mensch–KI-Interaktion", terms: ["human ai interaction", "human-ai interaction", "human machine interaction", "human-machine interaction", "human robot interaction", "human-robot interaction"] },
      { id: "teaming", label: "Teaming", terms: ["human ai teaming", "human-ai teaming", "human machine teaming", "human-machine teaming", "human robot teaming", "human-robot teaming"] },
      { id: "co-learning", label: "Co-Learning", terms: ["co-learning", "colearning", "mutual learning", "reciprocal learning"] },
      { id: "hybrid", label: "Hybride Intelligenz", terms: ["hybrid intelligence", "augmented intelligence", "human in the loop", "human-in-the-loop", "ai coworker", "ai co-worker"] }
    ]
  },
  {
    id: "motivation",
    label: "Motivation & Wohlbefinden",
    shortLabel: "Motivation",
    rationale: "Engagement, Motivation, Beanspruchung und arbeitsbezogenes Wohlbefinden.",
    lensQuestion: "Unter welchen Bedingungen stärkt KI Engagement und sinnvolle Arbeit, und wann erzeugt sie Erschöpfung oder Abhängigkeit?",
    concepts: [
      { id: "motivation", label: "Motivation", terms: ["motivation", "motivational", "intrinsic motivation", "extrinsic motivation"] },
      { id: "engagement", label: "Engagement", terms: ["work engagement", "employee engagement", "cognitive engagement", "engagement"] },
      { id: "wellbeing", label: "Wohlbefinden", terms: ["wellbeing", "well-being", "well being", "worker wellbeing", "employee wellbeing"] },
      { id: "strain", label: "Beanspruchung", terms: ["exhaustion", "burnout", "anxiety", "technostress", "job stress"] },
      { id: "affect", label: "Affekt", terms: ["affect", "affective", "emotion", "emotions", "emotional response"] }
    ]
  },
  {
    id: "safety",
    label: "Sicherheit & Resilienz",
    shortLabel: "Sicherheit",
    rationale: "Sichere, resiliente und beaufsichtigbare KI-Unterstützung.",
    lensQuestion: "Wie muss KI in sicherheitskritischen Systemen gestaltet sein, damit Menschen Abweichungen erkennen und wirksam intervenieren können?",
    concepts: [
      { id: "safety", label: "Sicherheit", terms: ["safety", "safe operation", "operational safety", "patient safety"] },
      { id: "critical", label: "Sicherheitskritisch", terms: ["safety critical", "safety-critical", "high risk", "high-risk", "critical system", "critical systems"] },
      { id: "resilience", label: "Resilienz", terms: ["resilience", "resilient", "resilience engineering"] },
      { id: "risk", label: "Risiko", terms: ["risk", "risks", "risk assessment", "hazard", "hazards"] },
      { id: "oversight", label: "Menschliche Aufsicht", terms: ["human oversight", "human supervision", "human intervention", "operator intervention"] },
      { id: "failure", label: "Fehler", terms: ["failure", "failures", "system failure", "automation failure"] }
    ]
  },
  {
    id: "participation",
    label: "Partizipation & Fairness",
    shortLabel: "Partizipation",
    rationale: "Beteiligung, Fairness, Inklusion und soziotechnische Machtverhältnisse.",
    lensQuestion: "Wer darf KI-gestützte Arbeitssysteme mitgestalten, und wie verändert die Machtverteilung ihre Wirkung?",
    concepts: [
      { id: "participation", label: "Partizipation", terms: ["participation", "participatory", "participative", "co-design", "codesign"] },
      { id: "fairness", label: "Fairness", terms: ["fairness", "justice", "organizational justice"] },
      { id: "inclusion", label: "Inklusion", terms: ["inclusion", "inclusive", "inclusivity", "accessibility"] },
      { id: "voice", label: "Beschäftigtenstimme", terms: ["worker voice", "employee voice", "worker participation", "employee participation"] },
      { id: "governance", label: "Governance", terms: ["governance", "ai governance", "algorithmic governance", "power asymmetry", "power imbalance", "dignity"] }
    ]
  }
]);

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) ?? null;
}
