export function bindLegacyCalibrationControls({ get, state, apply, reset, suggest, recordStake, fillSuggestion, syncMode, syncAi } = {}) {
  get("btn-legacy-params-apply")?.addEventListener("click", () => apply());
  get("btn-legacy-params-reset")?.addEventListener("click", () => reset());
  get("btn-legacy-params-ai")?.addEventListener("click", () => suggest());
  get("btn-legacy-stake-record")?.addEventListener("click", () => recordStake());
  get("btn-legacy-params-ai-fill")?.addEventListener("click", () => fillSuggestion());
  get("legacy-calibration-mode")?.addEventListener("change", (event) => {
    state.legacyDepthCalibSuggestion = null;
    state.legacyDepthCalibBaseParams = null;
    syncAi("");
    if (event.target.value === "field-stake") {
      state.legacyFieldCalibrationReadings = [];
      state.legacyFieldCalibrationBeforeM = null;
      state.legacyFieldCalibrationAfterM = null;
    }
    syncMode();
  });
}
