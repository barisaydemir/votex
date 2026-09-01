import * as THREE from "three";
import { $, state } from "../app/state.js";
import { mapToWorld } from "../viewer/coords.js";
import { invalidate } from "../viewer/scene.js";

/** @typedef {{ x: number, z: number }} WorldPt */

let enabled = false;
/** @type {WorldPt | null} */
let pointA = null;
/** @type {WorldPt | null} */
let pointB = null;
/** @type {WorldPt | null} */
let hover = null;
let bound = false;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
/** @type {{ LEFT: number, MIDDLE: number, RIGHT: number } | null} */
let savedMouseButtons = null;
/** @type {THREE.Group | null} */
let rulerGroup = null;

const Y_LIFT = 0.12;
const CYAN = 0x50dcff;

function mapMeters() {
  const s = state.surfaceState;
  const mapW = Number(
    s?.mapWidthM ?? s?.map_width_m ?? s?.mapSizeM ?? s?.map_size_m ?? 24
  );
  const gw = Number(s?.gridW ?? s?.grid_w ?? 0) || 1;
  const gh = Number(s?.gridH ?? s?.grid_h ?? 0) || 1;
  const mapD = Number(
    s?.mapDepthM ?? s?.map_depth_m ?? mapW * (gh / Math.max(gw, 1))
  );
  return {
    mapW: Number.isFinite(mapW) && mapW > 0 ? mapW : 24,
    mapD: Number.isFinite(mapD) && mapD > 0 ? mapD : 24,
  };
}

function worldDist(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function worldToNorm(p) {
  const { mapW, mapD } = mapMeters();
  return {
    x: p.x / mapW + 0.5,
    y: p.z / mapD + 0.5,
  };
}

function normToWorld(nx, ny) {
  const { mapW, mapD } = mapMeters();
  const w = mapToWorld(nx, ny, mapW, mapD);
  return { x: w.x, z: w.z };
}

function setReadout(text) {
  const el = $("ruler-readout");
  if (el) el.textContent = text;
}

function syncCanvasSize() {
  const img = $("preview");
  const canvas = $("preview-ruler");
  if (!img || !canvas) return false;
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (w < 8 || h < 8) return false;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const rect = img.getBoundingClientRect();
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return true;
}

function eventToNorm(e) {
  const img = $("preview");
  if (!img || !img.classList.contains("visible")) return null;
  const rect = img.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function drawCross(ctx, nx, ny, r, color) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const px = nx * w;
  const py = ny * h;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.004);
  ctx.beginPath();
  ctx.moveTo(px - r, py);
  ctx.lineTo(px + r, py);
  ctx.moveTo(px, py - r);
  ctx.lineTo(px, py + r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, Math.max(2.5, r * 0.35), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function applyOrbitMode(rulerOn) {
  const c = state.controls;
  if (!c) return;
  if (rulerOn) {
    if (!savedMouseButtons) {
      savedMouseButtons = {
        LEFT: c.mouseButtons.LEFT,
        MIDDLE: c.mouseButtons.MIDDLE,
        RIGHT: c.mouseButtons.RIGHT,
      };
    }
    // Sol tık = ölçüm; sağ tık = döndür
    c.mouseButtons.LEFT = -1;
    c.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    c.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  } else if (savedMouseButtons) {
    c.mouseButtons.LEFT = savedMouseButtons.LEFT;
    c.mouseButtons.MIDDLE = savedMouseButtons.MIDDLE;
    c.mouseButtons.RIGHT = savedMouseButtons.RIGHT;
    savedMouseButtons = null;
  }
}

function disposeGroup(g) {
  if (!g) return;
  g.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else {
        obj.material.map?.dispose?.();
        obj.material.dispose();
      }
    }
  });
}

function ensureRulerGroup() {
  if (!state.scene) return null;
  if (rulerGroup && rulerGroup.parent === state.scene) return rulerGroup;
  if (rulerGroup) {
    disposeGroup(rulerGroup);
    rulerGroup = null;
  }
  rulerGroup = new THREE.Group();
  rulerGroup.name = "mapRuler3d";
  state.scene.add(rulerGroup);
  return rulerGroup;
}

function makeLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(6, 12, 18, 0.85)";
  ctx.fillRect(8, 12, 240, 40);
  ctx.strokeStyle = "rgba(80, 220, 255, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 12, 240, 40);
  ctx.fillStyle = "#50dcff";
  ctx.font = "600 28px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.8, 0.7, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

function markerMesh() {
  const geo = new THREE.SphereGeometry(0.18, 12, 10);
  const mat = new THREE.MeshBasicMaterial({
    color: CYAN,
    depthTest: true,
  });
  return new THREE.Mesh(geo, mat);
}

function update3dVisuals() {
  if (!enabled || !state.scene) {
    if (rulerGroup) {
      state.scene?.remove(rulerGroup);
      disposeGroup(rulerGroup);
      rulerGroup = null;
    }
    return;
  }
  const g = ensureRulerGroup();
  if (!g) return;
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    disposeGroup(c);
  }

  const end = pointB || hover;
  if (pointA) {
    const m = markerMesh();
    m.position.set(pointA.x, Y_LIFT, pointA.z);
    g.add(m);
  }
  if (pointA && end) {
    const positions = new Float32Array([
      pointA.x,
      Y_LIFT,
      pointA.z,
      end.x,
      Y_LIFT,
      end.z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: pointB ? 0.95 : 0.55,
      depthTest: true,
    });
    g.add(new THREE.Line(geo, mat));

    if (pointB) {
      const m = markerMesh();
      m.position.set(pointB.x, Y_LIFT, pointB.z);
      g.add(m);
    }

    const m = worldDist(pointA, end);
    const label = makeLabelSprite(`${m.toFixed(1)} m`);
    label.position.set(
      (pointA.x + end.x) * 0.5,
      Y_LIFT + 0.55,
      (pointA.z + end.z) * 0.5
    );
    g.add(label);
  }
}

function redraw2d() {
  const canvas = $("preview-ruler");
  if (!canvas) return;
  if (!syncCanvasSize()) {
    const ctx0 = canvas.getContext("2d");
    if (ctx0) ctx0.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!enabled) return;

  const end = pointB || hover;
  const cyan = "rgba(80, 220, 255, 0.95)";
  const dim = "rgba(80, 220, 255, 0.55)";
  const r = Math.max(6, Math.min(w, h) * 0.012);

  if (pointA) {
    const a = worldToNorm(pointA);
    drawCross(ctx, a.x, a.y, r, cyan);
  }
  if (pointA && end) {
    const a = worldToNorm(pointA);
    const b = worldToNorm(end);
    const x0 = a.x * w;
    const y0 = a.y * h;
    const x1 = b.x * w;
    const y1 = b.y * h;
    ctx.setLineDash(pointB ? [] : [6, 5]);
    ctx.strokeStyle = pointB ? cyan : dim;
    ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.0035);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    if (pointB) drawCross(ctx, b.x, b.y, r, cyan);

    const m = worldDist(pointA, end);
    const label = `${m.toFixed(1)} m`;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    ctx.font = `600 ${Math.max(11, Math.min(w, h) * 0.028)}px Consolas, monospace`;
    const tw = ctx.measureText(label).width;
    const pad = 5;
    ctx.fillStyle = "rgba(6, 12, 18, 0.82)";
    ctx.fillRect(mx - tw * 0.5 - pad, my - 12, tw + pad * 2, 20);
    ctx.strokeStyle = "rgba(80, 220, 255, 0.45)";
    ctx.strokeRect(mx - tw * 0.5 - pad, my - 12, tw + pad * 2, 20);
    ctx.fillStyle = cyan;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mx, my);
  }
}

export function redrawRuler() {
  ensure3dListeners();
  if (enabled) applyOrbitMode(true);
  redraw2d();
  update3dVisuals();
  invalidate();
}

export function clearRuler() {
  pointA = null;
  pointB = null;
  hover = null;
  setReadout(enabled ? "A noktası…" : "—");
  redrawRuler();
}

export function setRulerEnabled(on) {
  enabled = !!on;
  const wrap = $("preview-wrap");
  wrap?.classList.toggle("ruler-on", enabled);
  $("viewer")?.classList.toggle("ruler-on", enabled);
  const canvas = $("preview-ruler");
  if (canvas) canvas.style.pointerEvents = enabled ? "auto" : "none";
  const chk = $("ruler-enable");
  if (chk && chk.checked !== enabled) chk.checked = enabled;
  applyOrbitMode(enabled);
  if (!enabled) {
    clearRuler();
    setReadout("—");
  } else {
    setReadout(pointA && pointB ? `${worldDist(pointA, pointB).toFixed(1)} m` : "A noktası…");
    redrawRuler();
  }
}

function placePoint(pt) {
  if (!pointA || pointB) {
    pointA = pt;
    pointB = null;
    hover = pt;
    setReadout("B noktası…");
  } else {
    pointB = pt;
    hover = null;
    setReadout(`${worldDist(pointA, pointB).toFixed(1)} m`);
  }
  redrawRuler();
}

function on2dPointerDown(e) {
  if (!enabled || e.button !== 0) return;
  const n = eventToNorm(e);
  if (!n) return;
  e.preventDefault();
  e.stopPropagation();
  placePoint(normToWorld(n.x, n.y));
}

function on2dPointerMove(e) {
  if (!enabled || !pointA || pointB) return;
  const n = eventToNorm(e);
  if (!n) return;
  hover = normToWorld(n.x, n.y);
  setReadout(`${worldDist(pointA, hover).toFixed(1)} m`);
  redrawRuler();
}

function raycastGround(e) {
  if (!state.renderer || !state.camera) return null;
  const el = state.renderer.domElement;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, state.camera);

  const targets = [];
  if (state.groundPlane) targets.push(state.groundPlane);
  if (targets.length) {
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      const p = hits[0].point;
      return { x: p.x, z: p.z };
    }
  }
  // Zemin yoksa y=0 düzlemi
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, hit)) {
    return { x: hit.x, z: hit.z };
  }
  return null;
}

let downPos = null;

function on3dPointerDown(e) {
  if (!enabled || e.button !== 0) return;
  downPos = { x: e.clientX, y: e.clientY };
}

function on3dPointerUp(e) {
  if (!enabled || e.button !== 0 || !downPos) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  downPos = null;
  if (dx * dx + dy * dy > 36) return; // sürükleme = orbit değil, yoksay (sol orbit kapalı)
  const pt = raycastGround(e);
  if (!pt) return;
  e.preventDefault();
  placePoint(pt);
}

function on3dPointerMove(e) {
  if (!enabled || !pointA || pointB) return;
  const pt = raycastGround(e);
  if (!pt) return;
  hover = pt;
  setReadout(`${worldDist(pointA, hover).toFixed(1)} m`);
  redrawRuler();
}

function onKeyDown(e) {
  if (!enabled) return;
  if (e.key === "Escape") {
    clearRuler();
  }
}

function ensure3dListeners() {
  const el = state.renderer?.domElement;
  if (!el || el.dataset.rulerBound === "1") return;
  el.dataset.rulerBound = "1";
  el.addEventListener("pointerdown", on3dPointerDown);
  el.addEventListener("pointerup", on3dPointerUp);
  el.addEventListener("pointermove", on3dPointerMove);
}

export function isRulerEnabled() {
  return enabled;
}

export function bindMapRuler() {
  if (bound) return;
  bound = true;
  const canvas = $("preview-ruler");
  if (canvas) {
    canvas.addEventListener("pointerdown", on2dPointerDown);
    canvas.addEventListener("pointermove", on2dPointerMove);
  }
  ensure3dListeners();
  const host = $("viewer");
  if (host) {
    new MutationObserver(() => {
      ensure3dListeners();
      if (enabled) applyOrbitMode(true);
    }).observe(host, { childList: true });
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", () => {
    if (enabled) redrawRuler();
  });
  $("ruler-enable")?.addEventListener("change", (e) => {
    setRulerEnabled(!!e.target.checked);
  });
  $("ruler-clear")?.addEventListener("click", () => {
    clearRuler();
  });
  setRulerEnabled(false);
}
