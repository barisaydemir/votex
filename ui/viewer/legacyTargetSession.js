/**
 * Legacy hedef oturumu — adım, obje ve görünüm seçimlerinin ortak sözleşmesi.
 * DOM veya Three.js bilmez; panel ve overlay aynı hedef kimliğini kullanır.
 */

/** Saha görev akışının anlamlı fazları ("3D doğrula" dahil). */
export const WORKFLOW_PHASES = Object.freeze({
  json: "json",
  step: "step",
  target: "target",
  focus: "focus",
});

export function selectedStepOf(session) {
  const value = Number(session?.stepIndex);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function selectedDetectionOf(session) {
  return session?.detectionId == null ? null : String(session.detectionId);
}

export function createLegacyTargetSession(input = {}) {
  const detectionId = input.detectionId == null ? null : String(input.detectionId);
  const stepIndex = selectedStepOf(input);
  const kind = detectionId ? "detection" : stepIndex ? "step" : "none";
  return {
    kind,
    stepIndex,
    detectionId,
    view: input.view === "target" ? "target" : "scene",
    visibility: input.visibility === "selected-only" ? "selected-only" : "step",
    source: String(input.source || "unknown"),
    workflowPhase: WORKFLOW_PHASES[input.workflowPhase] || input.workflowPhase || null,
  };
}

/**
 * Seçim eyleminden çıkacak görev fazını türet. Fazlar yalnız ileri ilerler;
 * daha geri bir eylem (ör. tekrar adım seçmek) mevcut fazı düşürmez.
 */
export function workflowPhaseForAction(kind, source = "") {
  const from = String(source || "");
  if (kind === "detection") {
    if (from === "camera-focus" || from === "target-navigation") return WORKFLOW_PHASES.focus;
    if (from === "detection-selection") return WORKFLOW_PHASES.target;
    return WORKFLOW_PHASES.target;
  }
  if (kind === "step") return WORKFLOW_PHASES.step;
  return null;
}

/** İki fazdan daha ileride olanı döndürür; tanınmayan değerler yok sayılır. */
export function advanceWorkflowPhase(current, next) {
  const order = [WORKFLOW_PHASES.json, WORKFLOW_PHASES.step, WORKFLOW_PHASES.target, WORKFLOW_PHASES.focus];
  const a = order.indexOf(current);
  const b = order.indexOf(next);
  if (b < 0) return current || null;
  if (a < 0 || a === WORKFLOW_PHASES.json) return next;
  return b > a ? next : current;
}

export function targetSessionForStep(stepIndex, input = {}) {
  const base = createLegacyTargetSession(input);
  return createLegacyTargetSession({
    ...base,
    ...input,
    stepIndex,
    detectionId: null,
    visibility: input.visibility || "step",
    workflowPhase: advanceWorkflowPhase(base.workflowPhase, workflowPhaseForAction("step", input.source)),
  });
}

export function targetSessionForDetection(detectionId, stepIndex, input = {}) {
  const base = createLegacyTargetSession({ ...input, detectionId, stepIndex });
  return createLegacyTargetSession({
    ...base,
    ...input,
    detectionId,
    stepIndex,
    visibility: "selected-only",
    workflowPhase: advanceWorkflowPhase(base.workflowPhase, workflowPhaseForAction("detection", input.source)),
  });
}

export function clearLegacyTargetSession(input = {}) {
  return createLegacyTargetSession({ ...input, stepIndex: null, detectionId: null });
}

export function moveDetectionTarget(detections, currentId, offset, input = {}) {
  const list = Array.isArray(detections) ? detections : [];
  if (!list.length) return clearLegacyTargetSession(input);
  let index = list.findIndex((item) => String(item?.detectionId) === String(currentId));
  if (index < 0) index = offset > 0 ? -1 : list.length;
  const nextIndex = Math.max(0, Math.min(list.length - 1, index + Number(offset || 0)));
  const next = list[nextIndex];
  return targetSessionForDetection(next.detectionId, next.stepIndex, {
    ...input,
    source: input.source || "target-navigation",
  });
}
