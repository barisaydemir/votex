import { getAppSettings, setStructuresThroughRed } from "../api/tauri.js";
import { $ } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";
import { t, tPhrase } from "../i18n/index.js";

/** @type {((surface: object) => void) | null} */
let onSurfaceFn = null;

export function bindStructuresThroughRed({ onSurface } = {}) {
  onSurfaceFn = onSurface || null;
  const el = $("structures-through-red");
  el?.addEventListener("change", async () => {
    const enabled = !!el.checked;
    updateThroughRedHint(enabled);
    try {
      const res = await setStructuresThroughRed(enabled);
      const msg = res?.message
        ? tPhrase(res.message)
        : enabled
          ? t("msg.redOn")
          : t("msg.redOff");
      logLine(msg, enabled ? "ok" : "warn");
      setStatus(msg);
      if (res?.rebuilt && res.surface) {
        onSurfaceFn?.(res.surface);
      }
    } catch (e) {
      el.checked = !enabled;
      updateThroughRedHint(!enabled);
      logLine(String(e?.message || e), "err");
    }
  });
}

export function updateThroughRedHint(enabled) {
  const hint = $("structures-through-red-hint");
  if (!hint) return;
  if (enabled === undefined) {
    enabled = $("structures-through-red")?.checked !== false;
  }
  hint.textContent = enabled ? t("red.hintOn") : t("red.hintOff");
}

export async function loadStructuresThroughRedUi() {
  try {
    const s = await getAppSettings();
    const enabled = s?.structuresThroughRed ?? s?.structures_through_red;
    const el = $("structures-through-red");
    if (el) el.checked = enabled !== false;
    updateThroughRedHint(enabled !== false);
  } catch (e) {
    console.warn("structuresThroughRed settings:", e);
  }
}

export function startThroughRedMonitor(opts) {
  bindStructuresThroughRed(opts);
  loadStructuresThroughRedUi();
}
