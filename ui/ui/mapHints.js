import { $ } from "../app/state.js";
import { getMapDtaHints, setMapDtaHintsEnabled } from "../api/tauri.js";

/** @type {((surface: object) => void) | null} */
let onSurfaceFn = null;
/** @type {((msg: string, kind?: string) => void) | null} */
let onLogFn = null;

export function bindMapHintsPanel({ onSurface, onLog } = {}) {
  onSurfaceFn = onSurface || null;
  onLogFn = onLog || null;
  const toggle = $("map-hints-enabled");
  toggle?.addEventListener("change", async () => {
    const enabled = !!toggle.checked;
    try {
      const res = await setMapDtaHintsEnabled(enabled);
      renderMapHintsPanel(res?.panel);
      const msg = res?.message || (enabled ? "DTA ipuçları açık" : "DTA ipuçları kapalı");
      onLogFn?.(msg, "ok");
      if (res?.rebuilt && res.surface) {
        onSurfaceFn?.(res.surface);
      }
    } catch (e) {
      toggle.checked = !enabled;
      onLogFn?.(String(e?.message || e), "err");
    }
  });
}

export async function refreshMapHintsPanel() {
  try {
    const panel = await getMapDtaHints();
    renderMapHintsPanel(panel);
  } catch {
    renderMapHintsPanel(null);
  }
}

export function renderMapHintsPanel(panel) {
  const host = $("map-hints-panel");
  const list = $("map-hints-list");
  const meta = $("map-hints-meta");
  const toggle = $("map-hints-enabled");
  const fold = $("map-hints-fold");
  if (!host || !list) return;

  if (!panel || !panel.mapId) {
    if (meta) meta.textContent = "Harita analiz edilince burada görünür.";
    if (toggle) {
      toggle.checked = true;
      toggle.disabled = true;
    }
    list.innerHTML = `<p class="hint compact">Kayıtlı DTA ipucu yok.</p>`;
    return;
  }

  if (toggle) {
    toggle.disabled = false;
    toggle.checked = panel.enabled !== false;
  }

  const name = panel.fileName || "bu harita";
  const shortId = String(panel.mapId).slice(0, 10);
  if (meta) {
    meta.textContent = `${name} · kayıt ${panel.storedCount ?? 0} · aktif ${panel.activeCount ?? 0} · ${shortId}…`;
  }

  const hints = panel.hints || [];
  if (!hints.length) {
    list.innerHTML = `<p class="hint compact">Bu harita için kayıtlı DTA ipucu yok.</p>`;
    return;
  }

  list.innerHTML = hints
    .map((h, i) => {
      const kind = String(h.kind || "?").toLowerCase();
      const label = h.label || `İpucu ${i + 1}`;
      const cx = Number(h.cx);
      const cy = Number(h.cy);
      const pos =
        Number.isFinite(cx) && Number.isFinite(cy)
          ? `${(cx * 100).toFixed(0)}%, ${(cy * 100).toFixed(0)}%`
          : "—";
      return `<div class="map-hint-row" data-kind="${kind}">
        <span class="mh-kind">${kind}</span>
        <span class="mh-label">${escapeHtml(label)}</span>
        <span class="mh-pos">${pos}</span>
      </div>`;
    })
    .join("");

  if (fold && hints.length > 0 && !fold.open) {
    // keep user preference; don't force open
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
