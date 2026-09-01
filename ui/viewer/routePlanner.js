/**
 * routePlanner.js — 3D rota planlama ve çoklu nokta mesafe ölçümü.
 *
 * Kullanıcı 3D sahne üzerinde birden fazla nokta koyar:
 *   - Her iki nokta arasına çizgi + mesafe etiketi çizilir
 *   - Toplam rota mesafesi otomatik hesaplanır
 *   - Eğim profili (yükseklik farkı) gösterilir
 *   - Rota JSON olarak dışa aktarılabilir
 *
 * Kısayollar:
 *   R          → Rota planlayıcıyı aç/kapa
 *   Backspace  → Son noktayı sil (planlayıcı açıksa)
 *   Escape     → Rota planlayıcıyı kapat
 *
 * Not: Çizim tıklandığında OrbitControls sol tık devre dışıdır.
 */
import * as THREE from "three";
import { $, state } from "../app/state.js";
import { invalidate } from "./scene.js";

// ── Durum ──
let active = false;
/** @type {{ x: number, y: number, z: number }[]} */
let waypoints = [];
let routeGroup = null;
const Y_LIFT = 0.15;
const GOLD = 0xffd27a;
const CYAN = 0x50dcff;
const RED = 0xff6b6b;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let savedMouseButtons = null;
let bound = false;
let panelEl = null;

// ── Yardımcılar ──

function mapMeters() {
  const s = state.surfaceState;
  const mapW = Number(s?.mapWidthM ?? s?.map_width_m ?? s?.mapSizeM ?? s?.map_size_m ?? 24);
  const gw = Number(s?.gridW ?? s?.grid_w ?? 0) || 1;
  const gh = Number(s?.gridH ?? s?.grid_h ?? 0) || 1;
  const mapD = Number(s?.mapDepthM ?? s?.map_depth_m ?? mapW * (gh / Math.max(gw, 1)));
  return {
    mapW: Number.isFinite(mapW) && mapW > 0 ? mapW : 24,
    mapD: Number.isFinite(mapD) && mapD > 0 ? mapD : 24,
  };
}

function dist3(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function distXZ(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function elevDiff(a, b) {
  return b.y - a.y; // pozitif = yükselen
}

function slopePercent(a, b) {
  const h = Math.abs(elevDiff(a, b));
  const d = distXZ(a, b);
  if (d < 0.01) return 0;
  return (h / d) * 100;
}

// ── Raycast ──

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
      return { x: p.x, y: p.y, z: p.z };
    }
  }
  // Zemin yoksa y=0 düzlemi
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, hit)) {
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  return null;
}

// ── Orbit modu ──

function applyOrbitMode(routeOn) {
  const c = state.controls;
  if (!c) return;
  if (routeOn) {
    if (!savedMouseButtons) {
      savedMouseButtons = {
        LEFT: c.mouseButtons.LEFT,
        MIDDLE: c.mouseButtons.MIDDLE,
        RIGHT: c.mouseButtons.RIGHT,
      };
    }
    // Sol tık = nokta koy; sağ tık = döndür
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

// ── 3D Görseller ──

function disposeGroup(g) {
  if (!g) return;
  g.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose?.();
    }
  });
}

function ensureRouteGroup() {
  if (!state.scene) return null;
  if (routeGroup && routeGroup.parent === state.scene) return routeGroup;
  if (routeGroup) { disposeGroup(routeGroup); routeGroup = null; }
  routeGroup = new THREE.Group();
  routeGroup.name = "routePlanner3d";
  state.scene.add(routeGroup);
  return routeGroup;
}

function waypointMarker(idx) {
  const geo = new THREE.SphereGeometry(0.22, 14, 10);
  const mat = new THREE.MeshBasicMaterial({ color: GOLD, depthTest: true });
  const mesh = new THREE.Mesh(geo, mat);
  // Numara etiketi
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(6,12,18,0.85)";
  ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,210,122,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#ffd27a";
  ctx.font = "bold 28px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(idx + 1), 32, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.8, 0.8, 1);
  sprite.position.set(0, 0.7, 0);
  const group = new THREE.Group();
  group.add(mesh);
  group.add(sprite);
  return group;
}

function distanceLabel(text, a, b) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 56);
  ctx.fillStyle = "rgba(6,12,18,0.82)";
  ctx.fillRect(4, 8, 248, 40);
  ctx.strokeStyle = "rgba(80,220,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(4, 8, 248, 40);
  ctx.fillStyle = "#50dcff";
  ctx.font = "600 24px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 28);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 0.52, 1);
  sprite.position.set((a.x + b.x) * 0.5, Y_LIFT + 0.5, (a.z + b.z) * 0.5);
  sprite.renderOrder = 999;
  return sprite;
}

function update3dVisuals() {
  if (!active || !state.scene) {
    if (routeGroup) { state.scene?.remove(routeGroup); disposeGroup(routeGroup); routeGroup = null; }
    return;
  }
  const g = ensureRouteGroup();
  if (!g) return;
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    disposeGroup(c);
  }

  // Noktalar
  waypoints.forEach((pt, i) => {
    const marker = waypointMarker(i);
    marker.position.set(pt.x, Y_LIFT, pt.z);
    g.add(marker);
  });

  // Çizgiler + mesafe etiketleri
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];

    // Çizgi
    const positions = new Float32Array([
      a.x, Y_LIFT, a.z,
      b.x, Y_LIFT, b.z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
    });
    g.add(new THREE.Line(geo, mat));

    // Mesafe etiketi
    const segDist = distXZ(a, b);
    const elev = elevDiff(a, b);
    const slope = slopePercent(a, b);
    const label = `${segDist.toFixed(1)}m${Math.abs(elev) > 0.1 ? ` ↑${Math.abs(elev).toFixed(1)}m` : ""}`;
    g.add(distanceLabel(label, a, b));
  }
}

// ── Panel ──

function ensurePanel() {
  if (panelEl && panelEl.parentElement) return panelEl;
  panelEl = document.createElement("div");
  panelEl.id = "route-panel";
  panelEl.style.cssText = `
    position:fixed; top:60px; left:20px; width:320px; max-height:calc(100vh - 80px);
    background:#1a1a2e; border:1px solid #333; border-radius:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.5); z-index:9999; overflow-y:auto;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif; color:#e0e0e0; display:none;
  `;
  document.body.appendChild(panelEl);
  addPanelStyles();
  return panelEl;
}

function addPanelStyles() {
  if (document.getElementById("route-styles")) return;
  const style = document.createElement("style");
  style.id = "route-styles";
  style.textContent = `
    .rp-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #333; background:#16213e; border-radius:12px 12px 0 0; position:sticky; top:0; z-index:1; }
    .rp-title { font-size:13px; font-weight:600; }
    .rp-close { background:none; border:none; color:#888; font-size:18px; cursor:pointer; padding:0 4px; }
    .rp-close:hover { color:#fff; }
    .rp-summary { padding:10px 14px; background:#0f1a2a; border-bottom:1px solid #222; }
    .rp-total { font-size:22px; font-weight:800; color:#3edc8c; }
    .rp-sub { font-size:11px; color:#8ea8b8; margin-top:2px; }
    .rp-waypoints { padding:8px 14px; }
    .rp-wp { display:flex; align-items:center; gap:8px; padding:6px 8px; margin:3px 0; background:#16213e; border-radius:6px; font-size:12px; border-left:3px solid #ffd27a; }
    .rp-wp-num { width:22px; height:22px; min-width:22px; background:rgba(255,210,122,0.15); color:#ffd27a; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:11px; }
    .rp-wp-coords { color:#8ea8b8; font-family:'JetBrains Mono',monospace; font-size:10px; }
    .rp-actions { padding:10px 14px; display:flex; gap:6px; flex-wrap:wrap; }
    .rp-btn { padding:6px 12px; border:1px solid #333; background:#0e1520; color:#e0e0e0; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; transition:background 0.15s; }
    .rp-btn:hover { background:#1b2a4a; }
    .rp-btn.danger { border-color:#ff4a4a; color:#ff6b6b; }
    .rp-btn.danger:hover { background:rgba(255,74,74,0.15); }
    .rp-btn.accent { border-color:#3edc8c; color:#3edc8c; }
    .rp-btn.accent:hover { background:rgba(62,220,140,0.15); }
    .rp-empty { padding:20px; text-align:center; color:#5a7080; font-size:12px; }
    .rp-seg-detail { font-size:10px; color:#5a7080; padding:2px 8px 2px 38px; }
  `;
  document.head.appendChild(style);
}

function renderPanel() {
  const panel = ensurePanel();
  if (!active) { panel.style.display = "none"; return; }

  let totalDist = 0;
  let totalElevGain = 0;
  let totalElevLoss = 0;
  const segments = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const d = distXZ(a, b);
    const elev = elevDiff(a, b);
    totalDist += d;
    if (elev > 0) totalElevGain += elev;
    else totalElevLoss += Math.abs(elev);
    segments.push({ from: i + 1, to: i + 2, dist: d, elev });
  }

  const avgSlope = waypoints.length >= 2
    ? (Math.abs(elevDiff(waypoints[0], waypoints[waypoints.length - 1])) / Math.max(totalDist, 0.01) * 100)
    : 0;

  let wpHtml = "";
  if (waypoints.length === 0) {
    wpHtml = '<div class="rp-empty">3D sahne üzerinde nokta koyun<br><small>Sol tık = nokta ekle · Backspace = son noktayı sil</small></div>';
  } else {
    waypoints.forEach((pt, i) => {
      wpHtml += `
        <div class="rp-wp">
          <div class="rp-wp-num">${i + 1}</div>
          <div>
            <div>Nokta ${i + 1}</div>
            <div class="rp-wp-coords">X: ${pt.x.toFixed(2)}m · Z: ${pt.z.toFixed(2)}m · Y: ${(-pt.y).toFixed(2)}m derinlik</div>
          </div>
        </div>`;
      if (segments[i]) {
        const s = segments[i];
        const elevStr = Math.abs(s.elev) > 0.1
          ? ` · eğim: ${s.elev > 0 ? "↑" : "↓"}${Math.abs(s.elev).toFixed(1)}m (${slopePercent(waypoints[i], waypoints[i + 1]).toFixed(0)}%)`
          : "";
        wpHtml += `<div class="rp-seg-detail">├── ${s.dist.toFixed(1)}m${elevStr}</div>`;
      }
    });
  }

  panel.innerHTML = `
    <div class="rp-header">
      <span class="rp-title">📍 Rota Planlayıcı</span>
      <button class="rp-close" id="rp-close">✕</button>
    </div>
    ${waypoints.length > 0 ? `
    <div class="rp-summary">
      <div class="rp-total">${totalDist.toFixed(1)} m</div>
      <div class="rp-sub">
        ${waypoints.length} nokta · ${segments.length} segment
        ${totalElevGain > 0 ? ` · ↑${totalElevGain.toFixed(1)}m kazanç` : ""}
        ${totalElevLoss > 0 ? ` · ↓${totalElevLoss.toFixed(1)}m kayıp` : ""}
        ${avgSlope > 0.5 ? ` · ort. eğim %${avgSlope.toFixed(0)}` : ""}
      </div>
    </div>` : ""}
    <div class="rp-waypoints">${wpHtml}</div>
    <div class="rp-actions">
      <button class="rp-btn danger" id="rp-clear">🗑️ Temizle</button>
      <button class="rp-btn" id="rp-undo">↩️ Geri Al</button>
      ${waypoints.length >= 2 ? `<button class="rp-btn accent" id="rp-export">📋 Dışa Aktar</button>` : ""}
    </div>
  `;

  panel.style.display = "block";

  // Event listeners
  panel.querySelector("#rp-close")?.addEventListener("click", () => setActive(false));
  panel.querySelector("#rp-clear")?.addEventListener("click", clearRoute);
  panel.querySelector("#rp-undo")?.addEventListener("click", undoLast);
  panel.querySelector("#rp-export")?.addEventListener("click", exportRoute);
}

// ── Eylemler ──

function addWaypoint(pt) {
  waypoints.push(pt);
  update3dVisuals();
  renderPanel();
  invalidate();
}

function clearRoute() {
  waypoints = [];
  update3dVisuals();
  renderPanel();
  invalidate();
}

function undoLast() {
  if (waypoints.length === 0) return;
  waypoints.pop();
  update3dVisuals();
  renderPanel();
  invalidate();
}

function exportRoute() {
  if (waypoints.length < 2) return;

  let totalDist = 0;
  const segments = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const d = distXZ(a, b);
    totalDist += d;
    segments.push({
      from: i + 1,
      to: i + 2,
      distance_m: Math.round(d * 100) / 100,
      elev_diff_m: Math.round(elevDiff(a, b) * 100) / 100,
      slope_pct: Math.round(slopePercent(a, b) * 10) / 10,
    });
  }

  const data = {
    name: `Rota ${new Date().toLocaleDateString("tr-TR")}`,
    created: new Date().toISOString(),
    total_distance_m: Math.round(totalDist * 100) / 100,
    waypoint_count: waypoints.length,
    waypoints: waypoints.map((pt, i) => ({
      num: i + 1,
      x: Math.round(pt.x * 100) / 100,
      z: Math.round(pt.z * 100) / 100,
      depth_m: Math.round((-pt.y) * 100) / 100,
    })),
    segments,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rota-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Olay dinleyicileri ──

let downPos = null;

function onPointerDown(e) {
  if (!active || e.button !== 0) return;
  downPos = { x: e.clientX, y: e.clientY };
}

function onPointerUp(e) {
  if (!active || e.button !== 0 || !downPos) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  downPos = null;
  if (dx * dx + dy * dy > 36) return; // sürükleme
  const pt = raycastGround(e);
  if (!pt) return;
  e.preventDefault();
  addWaypoint(pt);
}

function onKeyDown(e) {
  if (!active) return;
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.key === "Escape") {
    setActive(false);
    e.preventDefault();
  } else if (e.key === "Backspace" || e.key === "Delete") {
    undoLast();
    e.preventDefault();
  }
}

function ensureListeners() {
  const el = state.renderer?.domElement;
  if (!el || el.dataset.routeBound === "1") return;
  el.dataset.routeBound = "1";
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointerup", onPointerUp);
}

// ── Açık/Kapalı ──

export function setActive(on) {
  active = !!on;
  applyOrbitMode(active);
  ensureListeners();
  renderPanel();
  update3dVisuals();
  invalidate();

  if (!active) {
    // Temizleme — ama rotayı koru (sadece paneli kapat)
  }
}

export function isActive() {
  return active;
}

export function getWaypoints() {
  return [...waypoints];
}

export function bindRoutePlanner() {
  if (bound) return;
  bound = true;
  ensureListeners();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", () => { if (active) update3dVisuals(); });
}

export function clearRoutePublic() {
  clearRoute();
}
