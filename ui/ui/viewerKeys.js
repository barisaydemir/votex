/**
 * viewerKeys.js — 3D görünüm modları için klavye kısayolları.
 *
 *   X          → X-Ray / fresnel görünümü aç-kapa
 *   K          → Kesit (clipping) modu aç-kapa
 *   ↑ / ↓      → Kesit yüksekliği ±1 m (kesit açıkken)
 *   N          → Annotation / not ekleme modu aç-kapa
 *
 * Not: Odak bir form elemanındaysa (input/select/textarea) kısayollar
 * devre dışıdır — slider'ın kendi ok tuşu davranışı bozulmaz.
 */
import { $, state } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { setClipEnabled, setClipHeight } from "../viewer/scene.js";
import { setXray } from "../viewer/xray.js";
import { toggleAnnotationMode, isAnnotationMode } from "./annotations.js";

function isFormTarget(e) {
  const tag = e.target?.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    e.target?.isContentEditable
  );
}

/** Checkbox'ı senkronla + modül durumunu uygula (change event'i programatik tetiklenmez). */
function applyClipUi(on) {
  const box = $("clip-enabled");
  if (box) box.checked = !!on;
  const slider = $("clip-height");
  if (slider) slider.disabled = !on;
  setClipEnabled(on);
}

/** Kesit yüksekliğini slider aralığı içinde kaydır; UI + sahneyi güncelle. */
function nudgeClip(deltaM) {
  const slider = $("clip-height");
  if (!slider || !state.clipEnabled) return false;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const v = Math.min(max, Math.max(min, (Number(slider.value) || 0) + deltaM));
  if (v === Number(slider.value)) return false;
  slider.value = String(v);
  const label = $("clip-height-label");
  if (label) label.textContent = `${v} m`;
  setClipHeight(v);
  return true;
}

export function bindViewerKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isFormTarget(e)) return;

    const key = e.key.toLowerCase();

    if (key === "x") {
      const next = !state.xray;
      setXray(next);
      const box = $("xray-toggle");
      if (box) box.checked = next;
      setStatus(next ? "X-Ray: açık (X ile kapat)" : "X-Ray: kapalı");
      e.preventDefault();
    } else if (key === "k") {
      const next = !state.clipEnabled;
      applyClipUi(next);
      setStatus(next ? "Kesit: açık — ↑/↓ yükseklik (K ile kapat)" : "Kesit: kapalı");
      e.preventDefault();
    } else if (key === "n") {
      const next = !isAnnotationMode();
      toggleAnnotationMode();
      setStatus(next ? "Not ekleme: açık — haritaya tıklayın (N ile kapat)" : "Not ekleme: kapalı");
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      if (nudgeClip(1)) e.preventDefault();
    } else if (e.key === "ArrowDown") {
      if (nudgeClip(-1)) e.preventDefault();
    }
  });
}
