export const WORKFLOW_STEPS = Object.freeze([
  { key: "json", label: "JSON" },
  { key: "step", label: "Adım" },
  { key: "target", label: "Hedef" },
  { key: "focus", label: "3D doğrula" },
  { key: "notes", label: "Not / rapor" },
]);

export function deriveLegacyWorkflow({ hasJson = false, hasStep = false, hasTarget = false, hasFocus = false, hasNotes = false } = {}) {
  const done = { json: !!hasJson, step: !!hasStep, target: !!hasTarget, focus: !!hasFocus, notes: !!hasNotes };
  const steps = WORKFLOW_STEPS.map((step) => ({ ...step, done: done[step.key] }));
  return { steps, completed: steps.filter((step) => step.done).length, next: steps.find((step) => !step.done) || null };
}
