export const WORKSPACE_KEY = "radar.personal-workspace.v1";
export function validateWorkspace(value) {
  if (value?.version !== 1 || !value.notes || typeof value.notes !== "object" || Array.isArray(value.notes) || !Array.isArray(value.ideas)) throw new Error("Ungültiges Projektdateiformat.");
  const notes = Object.create(null);
  for (const [id, note] of Object.entries(value.notes)) {
    if (["__proto__", "constructor", "prototype"].includes(id) || typeof note !== "string" || note.length > 10000) throw new Error("Ungültige Notiz.");
    notes[id] = note;
  }
  const ids = new Set();
  const ideas = value.ideas.map(idea => {
    if (typeof idea.id !== "string" || ids.has(idea.id) || typeof idea.question !== "string" || idea.question.length > 2000 || !["saved", "reading", "planning", "archived"].includes(idea.stage)) throw new Error("Ungültige Projektidee.");
    ids.add(idea.id);
    return { id: idea.id, question: idea.question, stage: idea.stage, evidenceWorkIds: Array.isArray(idea.evidenceWorkIds) ? idea.evidenceWorkIds.filter(id => typeof id === "string").slice(0, 30) : [], savedAt: typeof idea.savedAt === "string" ? idea.savedAt : null };
  });
  return { version: 1, notes, ideas };
}
export function readWorkspace(storage) {
  try { const raw = (storage ?? globalThis.localStorage).getItem(WORKSPACE_KEY); return raw ? validateWorkspace(JSON.parse(raw)) : { version: 1, notes: {}, ideas: [] }; }
  catch { return { version: 1, notes: {}, ideas: [] }; }
}
export function writeWorkspace(value, storage = localStorage) {
  storage.setItem(WORKSPACE_KEY, JSON.stringify(validateWorkspace(value)));
}
