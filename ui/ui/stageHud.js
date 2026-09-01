import * as THREE from "three";
import { $, state } from "../app/state.js";
import { depthRangeOf } from "../viewer/coords.js";
import { formatDepthM } from "../viewer/colors.js";

const CARDINALS = [
  { max: 22.5, label: "K" },
  { max: 67.5, label: "KD" },
  { max: 112.5, label: "D" },
  { max: 157.5, label: "GD" },
  { max: 202.5, label: "G" },
  { max: 247.5, label: "GB" },
  { max: 292.5, label: "B" },
  { max: 337.5, label: "KB" },
  { max: 360.1, label: "K" },
];

const _dir = new THREE.Vector3();
let _lastDeg = -1;
let _builtScale = false;

function cardinalFromDeg(deg) {
  const d = ((deg % 360) + 360) % 360;
  for (const c of CARDINALS) {
    if (d < c.max) return c.label;
  }
  return "K";
}

/** Harita kuzeyi = −Z; kamera bakış yönünden pusula derecesi. */
export function viewHeadingDeg() {
  if (!state.camera) return 0;
  state.camera.getWorldDirection(_dir);
  let deg = (Math.atan2(_dir.x, -_dir.z) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function focusDepthM() {
  const id = state.selectedStructureId;
  if (id && state.structureTargets[id]) {
    const t = state.structureTargets[id];
    if (Number.isFinite(t.depthM)) return Math.max(0, t.depthM);
    if (t.position) return Math.max(0, -t.position.y);
  }
  if (state.controls?.target) {
    return Math.max(0, -state.controls.target.y);
  }
  return 0;
}

function ensureHudDom() {
  const host = $("viewer");
  if (!host || $("stage-hud")) return;

  const hud = document.createElement("div");
  hud.id = "stage-hud";
  hud.className = "stage-hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML = `
    <div class="stage-hud-grid"></div>
    <div class="stage-compass">
      <div class="stage-compass-tape" id="stage-compass-tape"></div>
      <div class="stage-compass-center">
        <span class="stage-compass-deg" id="stage-compass-deg">0</span>
        <span class="stage-compass-card" id="stage-compass-card">K</span>
      </div>
    </div>
    <div class="stage-depth-rail" id="stage-depth-rail">
      <div class="stage-depth-gradient"></div>
      <div class="stage-depth-ticks" id="stage-depth-ticks"></div>
      <div class="stage-depth-marker" id="stage-depth-marker"></div>
    </div>
    <div class="stage-crosshair">
      <span class="stage-crosshair-ring"></span>
      <span class="stage-depth-readout" id="stage-depth-readout">Depth: —</span>
    </div>
  `;
  host.appendChild(hud);
  buildCompassTape();
}

function buildCompassTape() {
  const tape = $("stage-compass-tape");
  if (!tape) return;
  const labels = ["B", "KB", "K", "KD", "D", "GD", "G", "GB", "B"];
  tape.innerHTML = labels
    .map((lab, i) => {
      const major = lab.length === 1;
      return `<span class="tape-tick ${major ? "major" : ""}" style="--i:${i}">
        <i></i><b>${lab}</b>
      </span>`;
    })
    .join("");
}

function rebuildDepthScale(rangeM) {
  const ticks = $("stage-depth-ticks");
  if (!ticks) return;
  const range = Math.max(1, Number(rangeM) || 20);
  const steps = Math.min(12, Math.max(4, Math.round(range)));
  const parts = [];
  for (let i = 0; i <= steps; i++) {
    const m = (range * i) / steps;
    const pct = (i / steps) * 100;
    const label =
      m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(m >= 10 ? 0 : 1)} m`;
    parts.push(
      `<span class="depth-tick" style="top:${pct}%"><em></em><b>${label}</b></span>`
    );
  }
  ticks.innerHTML = parts.join("");
  _builtScale = true;
  ticks.dataset.range = String(range);
}

export function setStageHudVisible(on) {
  ensureHudDom();
  const hud = $("stage-hud");
  if (!hud) return;
  hud.classList.toggle("visible", !!on);
  const ph = $("placeholder");
  if (ph) ph.style.display = on ? "none" : "";
}

export function syncStageHudFromSurface(surface) {
  ensureHudDom();
  const range = depthRangeOf(surface);
  rebuildDepthScale(range);
  setStageHudVisible(!!surface);
  updateStageHud(true);
}

export function updateStageHud(force = false) {
  if (!$("stage-hud")?.classList.contains("visible") && !force) return;
  if (!state.camera) return;

  const deg = viewHeadingDeg();
  const degRound = Math.round(deg);
  if (force || degRound !== _lastDeg) {
    _lastDeg = degRound;
    const degEl = $("stage-compass-deg");
    const cardEl = $("stage-compass-card");
    const tape = $("stage-compass-tape");
    const card = cardinalFromDeg(deg);
    if (degEl) degEl.textContent = String(degRound);
    if (cardEl) cardEl.textContent = card;
    if (tape) {
      // Her sektör %12.5 (8×45°); K merkezde (index 2)
      const shiftPct = ((deg / 360) * 100) / 8;
      tape.style.transform = `translateX(calc(-12.5% - ${shiftPct}%))`;
    }
    const pDeg = $("preview-compass-deg");
    const pCard = $("preview-compass-card");
    if (pDeg) pDeg.textContent = String(degRound);
    if (pCard) pCard.textContent = card;
  }

  const depth = focusDepthM();
  const readout = $("stage-depth-readout");
  if (readout) {
    readout.textContent = `Depth: ${formatDepthM(depth)}`;
  }

  const range = depthRangeOf(state.surfaceState);
  const ticks = $("stage-depth-ticks");
  if (ticks && (!_builtScale || ticks.dataset.range !== String(range))) {
    rebuildDepthScale(range);
  }

  const marker = $("stage-depth-marker");
  if (marker && range > 0) {
    const t = Math.min(1, Math.max(0, depth / range));
    marker.style.top = `${t * 100}%`;
  }
}

export function initStageHud() {
  ensureHudDom();
  setStageHudVisible(false);
}
