import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { setStatus } from "../app/status.js";
import { updateStageHud } from "../ui/stageHud.js";
import { applyFreeDrawVisibility } from "./builders/freeDraw.js";
import { isValuableMetal } from "../i18n/labels.js";

export function fitText(ctx, text, maxWidth, baseSize, minSize = 11) {
  let size = baseSize;
  ctx.font = `bold ${size}px Segoe UI, sans-serif`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `bold ${size}px Segoe UI, sans-serif`;
  }
  return size;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function makeBadgeSprite(num, accentHex = "#7ec8e8") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 168;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 168);

  const cx = 64;
  const cy = 52;
  const r = 34;
  const tipY = 155;

  // Konum balonu (map pin) — dolgu, çerçeve yok
  ctx.fillStyle = accentHex;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.78, cy + r * 0.35);
  ctx.lineTo(cx + r * 0.78, cy + r * 0.35);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  ctx.fill();

  // Numara — büyük ve okunabilir
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), cx, cy + 1);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false, // rozet renkleri ACES'ten etkilenmesin
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.55, 0.73, 1);
  sprite.renderOrder = 999;
  sprite.userData.isBadge = true;
  return sprite;
}

export function makeDetailSprite(title, lines) {
  const lineArr = (Array.isArray(lines) ? lines : [String(lines || "")]).filter(Boolean);
  const canvas = document.createElement("canvas");
  const nLines = Math.min(lineArr.length, 3);
  canvas.width = 520;
  canvas.height = 120 + nLines * 26;
  const ctx = canvas.getContext("2d");
  const cH = canvas.height;
  ctx.clearRect(0, 0, 520, cH);
  const pad = 10;
  const boxW = 520 - pad * 2;
  const boxH = cH - pad * 2;
  // Çerçevesiz yumuşak balon
  ctx.fillStyle = "rgba(8, 16, 20, 0.78)";
  roundRect(ctx, pad, pad, boxW, boxH, 14);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff6e8";
  const titleSize = fitText(ctx, title, boxW - 28, 28, 16);
  ctx.font = `bold ${titleSize}px Segoe UI, sans-serif`;
  ctx.fillText(title, 260, 48);
  ctx.fillStyle = "#d7e8f2";
  lineArr.slice(0, 3).forEach((line, i) => {
    const size = fitText(ctx, line, boxW - 32, 17, 13);
    ctx.font = `${size}px Segoe UI, sans-serif`;
    ctx.fillText(line, 260, 72 + i * 24);
  });
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false, // etiket renkleri ACES'ten etkilenmesin
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.0, 0.85, 1);
  sprite.renderOrder = 1000;
  sprite.visible = false;
  sprite.userData.isDetailLabel = true;
  return sprite;
}

function worldPosOf(object, fallback) {
  if (object?.getWorldPosition) return object.getWorldPosition(new THREE.Vector3());
  return fallback?.clone?.() || new THREE.Vector3();
}

function placeSelectionRing(position) {
  if (!state.scene || !position) return;
  if (state.selectionMarker) {
    state.scene.remove(state.selectionMarker);
    state.selectionMarker.geometry?.dispose();
    state.selectionMarker.material?.dispose();
    state.selectionMarker = null;
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.85, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      toneMapped: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  ring.position.y = Math.min(position.y + 0.15, -0.05);
  state.selectionMarker = ring;
  state.scene.add(state.selectionMarker);
  invalidate();
}

/**
 * Kamerayı animasyonla bir pozisyona taşı.
 * @param {THREE.Vector3} position - hedef nokta
 * @param {number} radius - yapı yarıçapı / boyutu
 * @param {string} title - HUD başlığı
 * @param {Object} [opts] - opsiyonel ayarlar
 * @param {number} [opts.duration] - animasyon süresi (ms, varsayılan 650)
 * @param {number} [opts.distScale] - kamera uzaklık çarpanı (varsayılan 2.4)
 * @param {number} [opts.heightScale] - kamera yükseklik çarpanı (varsayılan 0.55)
 */
export function flyCameraTo(position, radius, title, opts) {
  if (!state.camera || !state.controls || !position) return;
  placeSelectionRing(position);
  updateStageHud(true);

  const startCam = state.camera.position.clone();
  const startTarget = state.controls.target.clone();
  const endTarget = position.clone();
  const distScale = opts?.distScale ?? 2.4;
  const heightScale = opts?.heightScale ?? 0.55;
  const dist = Math.max(radius || 4, 4) * distScale;
  const endCam = endTarget.clone().add(new THREE.Vector3(dist * 0.75, dist * heightScale, dist * 0.8));
  const t0 = performance.now();
  const dur = opts?.duration ?? 650;

  function tick(now) {
    const u = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - u, 3);
    state.camera.position.lerpVectors(startCam, endCam, e);
    state.controls.target.lerpVectors(startTarget, endTarget, e);
    state.controls.update();
    invalidate(); // render-on-demand: uçuş boyunca kare çiz
    if (u < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  if (title) setStatus(`Odak: ${title}`);
}

export function focusStructure(id) {
  const entry = state.structureTargets[id];
  if (!entry || !state.camera || !state.controls) return;

  state.selectedStructureId = id;
  state.selectedFreeDrawId = null;
  document.querySelectorAll(".structure-card").forEach((el) => {
    el.classList.toggle("active", el.dataset.focusId === id);
  });
  document.querySelectorAll(".fd-item").forEach((el) => el.classList.remove("active"));

  Object.entries(state.structureTargets).forEach(([key, t]) => {
    if (t.detailLabel) t.detailLabel.visible = key === id;
  });

  flyCameraTo(entry.position, entry.radius, entry.title || id);
}

export function focusBestValuableMetal(surface) {
  const metals = surface?.structures?.metals || [];
  let bestI = -1;
  let bestS = -1;
  for (let i = 0; i < metals.length; i++) {
    const m = metals[i];
    if (!isValuableMetal(m)) continue;
    const s = Number(m.fieldStrength ?? m.field_strength ?? m.intensity ?? 0);
    if (s >= bestS) {
      bestS = s;
      bestI = i;
    }
  }
  if (bestI < 0) return false;
  const id = `metal-${bestI}`;
  if (!state.structureTargets[id]) return false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => focusStructure(id));
  });
  return true;
}

export function focusFreeDraw(id) {
  const entry = state.freeDrawTargets?.[id];
  if (!entry || !state.camera || !state.controls) return;

  if (entry.band || entry.via) {
    state.freeDrawBands = state.freeDrawBands || {};
    let restored = false;
    if (entry.band && state.freeDrawBands[entry.band] === false) {
      state.freeDrawBands[entry.band] = true;
      restored = true;
    }
    if (entry.via && state.freeDrawBands[entry.via] === false) {
      state.freeDrawBands[entry.via] = true;
      restored = true;
    }
    if (restored) applyFreeDrawVisibility();
  }

  state.selectedFreeDrawId = id;
  document.querySelectorAll(".structure-card").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".fd-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.fdId === id);
  });

  const pos = worldPosOf(entry.object, entry.position);
  flyCameraTo(pos, entry.radius, entry.title || id);
}
