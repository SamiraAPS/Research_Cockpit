export const THEME_ONTOLOGY_VERSION = "human-work-themes-2.0.0";
export const THEME_CLASSIFICATION_VERSION = "weighted-lexical-2.0.0";

export const THEME_SCORE_WEIGHTS = {
  title: 4,
  abstract: 1,
  keyword: 3,
  openalex_topic: 2,
} as const;

export const THEME_SCORE_THRESHOLD = 2;

export type ThemeEvidenceSource = keyof typeof THEME_SCORE_WEIGHTS;

export type ThemeConcept = {
  id: string;
  label: string;
  variants: readonly string[];
};

export type ThemeDefinition = {
  id: string;
  label: string;
  short: string;
  why: string;
  lensQuestion: string;
  concepts: readonly ThemeConcept[];
  excludedPhrases?: readonly string[];
};

export const THEME_ONTOLOGY: readonly ThemeDefinition[] = [
  {
    id: "learning",
    label: "Lernen & Deskilling",
    short: "Lernen",
    why: "Berührt Lernen, Expertiseerhalt und das Risiko kognitiver Abhängigkeit.",
    lensQuestion: "Wie kann KI so gestaltet werden, dass sie menschliche Lernschleifen erhält, statt Expertise schleichend zu ersetzen?",
    excludedPhrases: ["machine learning", "deep learning", "reinforcement learning", "representation learning", "federated learning"],
    concepts: [
      { id: "learning", label: "Lernen", variants: ["learning", "learn", "learner", "learners", "workplace learning", "learning process", "learning processes", "learning outcome", "learning outcomes"] },
      { id: "deskilling", label: "Deskilling", variants: ["deskilling", "de-skilling", "skill degradation", "skill loss", "skill erosion"] },
      { id: "expertise", label: "Expertise", variants: ["expertise", "expert", "experts", "expert performance", "skill retention", "knowledge retention"] },
      { id: "development", label: "Kompetenzentwicklung", variants: ["skill development", "competence development", "competency development", "upskilling", "reskilling", "scaffolding"] },
      { id: "offloading", label: "Kognitive Auslagerung", variants: ["cognitive offloading", "cognitive dependency", "automation dependency"] },
    ],
  },
  {
    id: "trust",
    label: "Vertrauen & Reliance",
    short: "Vertrauen",
    why: "Hilft zu verstehen, wann Menschen KI angemessen nutzen, prüfen oder übersteuern.",
    lensQuestion: "Wann führt Transparenz zu kalibriertem Vertrauen – und wann nur zu einem höheren subjektiven Sicherheitsgefühl?",
    concepts: [
      { id: "trust", label: "Vertrauen", variants: ["trust", "trusted", "trusting", "trustworthy", "trustworthiness"] },
      { id: "reliance", label: "Reliance", variants: ["reliance", "rely", "relying", "overreliance", "over-reliance", "underreliance", "under-reliance"] },
      { id: "calibration", label: "Kalibrierung", variants: ["calibration", "calibrated trust", "trust calibration", "appropriate reliance"] },
      { id: "automation-bias", label: "Automation Bias", variants: ["automation bias", "algorithm aversion", "algorithm appreciation"] },
      { id: "explainability", label: "Erklärbarkeit", variants: ["explainability", "explainable ai", "transparency", "transparent ai"] },
    ],
  },
  {
    id: "agency",
    label: "Work Design & Agency",
    short: "Agency",
    why: "Verbindet KI-Gestaltung mit Autonomie, sinnvoller Arbeit und Motivation.",
    lensQuestion: "Wie verändern KI-Systeme Autonomie, Rollensignifikanz und Aufgabenidentität in hochqualifizierter Arbeit?",
    concepts: [
      { id: "work-design", label: "Arbeitsgestaltung", variants: ["work design", "job design", "task design", "work redesign", "job redesign"] },
      { id: "agency", label: "Agency", variants: ["agency", "human agency", "worker agency", "agentic"] },
      { id: "autonomy", label: "Autonomie", variants: ["autonomy", "autonomous work", "job autonomy", "task autonomy"] },
      { id: "meaning", label: "Sinnvolle Arbeit", variants: ["meaningful work", "meaning of work", "work meaningfulness", "task significance", "role significance", "task identity"] },
      { id: "management", label: "Algorithmisches Management", variants: ["algorithmic management", "algorithmic control", "worker control", "digital labor control"] },
    ],
  },
  {
    id: "cognition",
    label: "Kognitive Arbeit",
    short: "Kognition",
    why: "Fokussiert kognitive Belastung, Situation Awareness und Entscheidungsqualität.",
    lensQuestion: "Welche adaptive Unterstützung entlastet, ohne Wahrnehmung, Verständnis und Projektion zu unterminieren?",
    concepts: [
      { id: "load", label: "Kognitive Belastung", variants: ["cognitive load", "mental workload", "cognitive workload", "workload"] },
      { id: "awareness", label: "Situation Awareness", variants: ["situation awareness", "situational awareness"] },
      { id: "attention", label: "Aufmerksamkeit", variants: ["attention", "attentional", "vigilance"] },
      { id: "decision", label: "Entscheiden", variants: ["decision making", "decision-making", "decision support", "decision quality"] },
      { id: "sensemaking", label: "Sensemaking", variants: ["sensemaking", "sense-making", "mental model", "mental models", "cognitive readiness"] },
    ],
  },
  {
    id: "teaming",
    label: "Human–AI Teaming",
    short: "Teaming",
    why: "Zeigt Gestaltungsoptionen für komplementäre, lernfähige Mensch–KI-Teams.",
    lensQuestion: "Welche Interaktionsmuster ermöglichen Co-Learning statt einseitiger Delegation und einseitigem Modelllernen?",
    concepts: [
      { id: "collaboration", label: "Mensch–KI-Kollaboration", variants: ["human ai collaboration", "human-ai collaboration", "human machine collaboration", "human-machine collaboration"] },
      { id: "interaction", label: "Mensch–KI-Interaktion", variants: ["human ai interaction", "human-ai interaction", "human machine interaction", "human-machine interaction"] },
      { id: "teaming", label: "Teaming", variants: ["human ai teaming", "human-ai teaming", "human machine teaming", "human-machine teaming", "human robot teaming", "human-robot teaming"] },
      { id: "co-learning", label: "Co-Learning", variants: ["co-learning", "colearning", "mutual learning", "reciprocal learning"] },
      { id: "hybrid", label: "Hybride Intelligenz", variants: ["hybrid intelligence", "augmented intelligence", "human in the loop", "human-in-the-loop", "ai coworker", "ai co-worker"] },
    ],
  },
  {
    id: "motivation",
    label: "Motivation & Wohlbefinden",
    short: "Motivation",
    why: "Verbindet KI-Nutzung mit Engagement, Motivation und arbeitsbezogenem Wohlbefinden.",
    lensQuestion: "Unter welchen Bedingungen stärkt KI Engagement und sinnvolle Arbeit – und wann erzeugt sie Erschöpfung oder Abhängigkeit?",
    concepts: [
      { id: "motivation", label: "Motivation", variants: ["motivation", "motivational", "intrinsic motivation", "extrinsic motivation"] },
      { id: "engagement", label: "Engagement", variants: ["work engagement", "employee engagement", "cognitive engagement", "engagement"] },
      { id: "wellbeing", label: "Wohlbefinden", variants: ["wellbeing", "well-being", "well being", "worker wellbeing", "employee wellbeing"] },
      { id: "strain", label: "Beanspruchung", variants: ["exhaustion", "burnout", "anxiety", "technostress", "job stress"] },
      { id: "affect", label: "Affekt", variants: ["affect", "affective", "emotion", "emotions", "emotional response"] },
    ],
  },
  {
    id: "safety",
    label: "Sicherheit & Resilienz",
    short: "Sicherheit",
    why: "Überträgt Human-Factors-Prinzipien auf sichere, resiliente KI-Unterstützung.",
    lensQuestion: "Wie muss KI in sicherheitskritischen Systemen gestaltet sein, damit Menschen Abweichungen erkennen und wirksam intervenieren können?",
    concepts: [
      { id: "safety", label: "Sicherheit", variants: ["safety", "safe operation", "operational safety", "patient safety"] },
      { id: "critical", label: "Sicherheitskritisch", variants: ["safety critical", "safety-critical", "high risk", "high-risk", "critical system", "critical systems"] },
      { id: "resilience", label: "Resilienz", variants: ["resilience", "resilient", "resilience engineering"] },
      { id: "risk", label: "Risiko", variants: ["risk", "risks", "risk assessment", "hazard", "hazards"] },
      { id: "oversight", label: "Menschliche Aufsicht", variants: ["human oversight", "human supervision", "human intervention", "operator intervention"] },
      { id: "failure", label: "Fehler", variants: ["failure", "failures", "system failure", "automation failure"] },
    ],
  },
  {
    id: "participation",
    label: "Partizipation & Fairness",
    short: "Partizipation",
    why: "Lenkt den Blick auf Beteiligung, Fairness und soziotechnische Machtverhältnisse.",
    lensQuestion: "Wer darf KI-gestützte Arbeitssysteme mitgestalten – und wie verändern Beteiligung und Machtverteilung ihre Wirkung?",
    concepts: [
      { id: "participation", label: "Partizipation", variants: ["participation", "participatory", "participative", "co-design", "codesign"] },
      { id: "fairness", label: "Fairness", variants: ["fairness", "fair", "justice", "organizational justice"] },
      { id: "inclusion", label: "Inklusion", variants: ["inclusion", "inclusive", "inclusivity", "accessibility"] },
      { id: "voice", label: "Beschäftigtenstimme", variants: ["worker voice", "employee voice", "worker participation", "employee participation"] },
      { id: "governance", label: "Governance", variants: ["governance", "ai governance", "algorithmic governance", "power asymmetry", "power imbalance", "dignity"] },
    ],
  },
] as const;

export type ThemeId = (typeof THEME_ONTOLOGY)[number]["id"];

export function findThemeDefinition(themeId: string) {
  return THEME_ONTOLOGY.find((theme) => theme.id === themeId) ?? null;
}

export function configuredVocabularySize(theme: ThemeDefinition) {
  return new Set(theme.concepts.flatMap((concept) => concept.variants)).size;
}
