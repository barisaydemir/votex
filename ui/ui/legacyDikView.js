export function syncLegacyTargetModeView({ get, state, createSession } = {}) {
  const box = get("legacy-dik-box");
  const button = get("btn-legacy-target-mode");
  const card = get("legacy-target-card");
  const on = !!state.legacyTargetMode;
  state.legacyTargetSession = createSession({ ...state.legacyTargetSession, view: on ? "target" : "scene", source: "view-mode" });
  box?.classList.toggle("is-target-mode", on);
  if (button) {
    button.classList.toggle("accent", on);
    button.textContent = on ? "🎯 Hedef modundan çık" : "🎯 Hedef modu";
    button.setAttribute("aria-pressed", String(on));
  }
  if (card && on) card.hidden = false;
}

export function syncSelectView({ get, id, value, disabled = false } = {}) {
  const select = get(id);
  if (!select) return;
  select.value = value;
  select.disabled = disabled;
}

export function syncStepNumberInputView({ get, state, selectedStep, count } = {}) {
  const input = get("legacy-step-number-input");
  const button = get("btn-legacy-step-go");
  if (input) {
    input.disabled = !state.legacyDikResult;
    input.max = String(Math.max(count, 1));
    input.value = selectedStep == null ? "" : String(selectedStep);
  }
  if (button) button.disabled = !state.legacyDikResult || count < 1;
}

export function applyLegacyListFilterView(list, filter, matches) {
  if (!list) return;
  const showSteps = filter !== "detections";
  list.querySelectorAll(".legacy-step-summary, .legacy-step-list, .legacy-step-list + div").forEach((el) => {
    el.style.display = showSteps ? "" : "none";
  });
  list.querySelectorAll(".legacy-step-card").forEach((el) => {
    const visible = matches(filter, { status: el.dataset.legacyStatus, anomalyCount: el.dataset.legacyHasDetection === "1", isDetection: false });
    el.style.display = visible && showSteps ? "block" : "none";
  });
  list.querySelectorAll(".legacy-anomaly-card").forEach((el) => {
    el.style.display = matches(filter, { status: el.dataset.legacyStatus, isDetection: true }) ? "block" : "none";
  });
}
