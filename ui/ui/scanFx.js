import { $ } from "../app/state.js";
import { heartbeatBusy } from "./heartbeat.js";

/** Analizi Başlat sırasında 2D laser sweep. */
export function startScanSweep() {
  const sweep = $("scan-sweep");
  const wrap = $("preview-wrap");
  if (sweep) sweep.classList.add("active");
  if (wrap) wrap.classList.remove("marks-pulse");
  heartbeatBusy(true);
}

export function stopScanSweep() {
  const sweep = $("scan-sweep");
  if (sweep) sweep.classList.remove("active");
  heartbeatBusy(false);
}

/** Yapı işaretleri bulunduktan sonra pulse glow. */
export function pulsePreviewMarks(on = true) {
  const wrap = $("preview-wrap");
  if (!wrap) return;
  wrap.classList.toggle("marks-pulse", !!on);
}

export function pulseStructureCards() {
  const host = $("structure-list");
  if (!host) return;
  host.querySelectorAll(".structure-card").forEach((el) => {
    el.classList.remove("pulse-in");
    void el.offsetWidth;
    el.classList.add("pulse-in");
  });
}
