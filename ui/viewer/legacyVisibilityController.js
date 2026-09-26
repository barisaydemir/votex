/**
 * Legacy seçim/görünürlük sözleşmesi.
 *
 * Three.js ve DOM'dan bağımsız tutulur; panel, overlay ve görselleştirme
 * controller'ı aynı katman adlarını ve geçiş kurallarını kullanır.
 */

export const LEGACY_VISIBILITY_LAYERS = Object.freeze({
  unifiedObjects: "unifiedObjects",
  undergroundSlices: "undergroundSlices",
});

export function unifiedObjectMapVisibleOf(state) {
  return !!state?.legacyUnifiedObjectMapVisible;
}

export function undergroundSlicesVisibleOf(state) {
  return !!state?.legacyUndergroundMapVisible;
}

export function setUnifiedObjectMapVisible(state, visible) {
  if (state) state.legacyUnifiedObjectMapVisible = !!visible;
  return !!visible;
}

export function setUndergroundSlicesVisible(state, visible) {
  if (state) state.legacyUndergroundMapVisible = !!visible;
  return !!visible;
}

/** UI'nin hangi bayrağı okuyacağını tek yerde tanımlar. */
export function legacyLayerStateOf(state) {
  return {
    unifiedObjects: unifiedObjectMapVisibleOf(state),
    undergroundSlices: undergroundSlicesVisibleOf(state),
  };
}

/**
 * Seçim eylemleri için saf geçiş sonucu.
 * Gerçek sahne uygulaması overlay'de kalır; bu fonksiyon yalnız ortak state
 * sözleşmesini üretir ve yanlış/boş seçimleri normalize eder.
 */
export function selectionTransition(previous = {}, action = {}) {
  const type = String(action?.type || "");
  const current = {
    kind: previous.kind || "none",
    stepIndex: Number.isFinite(Number(previous.stepIndex)) ? Number(previous.stepIndex) : null,
    detectionId: previous.detectionId == null ? null : String(previous.detectionId),
    view: previous.view === "target" ? "target" : "scene",
    visibility: previous.visibility === "selected-only" ? "selected-only" : "step",
    source: String(previous.source || "transition"),
    workflowPhase: previous.workflowPhase || null,
  };

  if (type === "CLEAR_SELECTION") {
    return { ...current, kind: "none", stepIndex: null, detectionId: null, visibility: "step", source: action.source || "clear" };
  }

  if (type === "SELECT_STEP") {
    const step = Number(action.stepIndex);
    if (!Number.isFinite(step) || step <= 0) return current;
    return {
      ...current,
      kind: "step",
      stepIndex: step,
      detectionId: null,
      visibility: "step",
      source: action.source || "step-selection",
      workflowPhase: current.workflowPhase === "focus" ? current.workflowPhase : "step",
    };
  }

  if (type === "SELECT_DETECTION") {
    if (action.detectionId == null || action.detectionId === "") return current;
    const step = Number(action.stepIndex);
    return {
      ...current,
      kind: "detection",
      stepIndex: Number.isFinite(step) && step > 0 ? step : current.stepIndex,
      detectionId: String(action.detectionId),
      visibility: "selected-only",
      source: action.source || "detection-selection",
      workflowPhase: current.workflowPhase === "focus" ? current.workflowPhase : "target",
    };
  }

  return current;
}
