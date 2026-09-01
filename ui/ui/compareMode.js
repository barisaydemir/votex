/**
 * compareMode.js — Çoklu harita karşılaştırma (yan yana / slider).
 *
 * İki haritayı tek 3D sahnede karşılaştırır:
 *   - Sol taraf: mevcut harita (A) — normal görünüm
 *   - Sağ taraf: karşılaştırma haritası (B) — mavi overlay + clip plane
 *   - Sürüklenebilir slider ile geçiş çizgisi
 *
 * Teknik: Three.js localClippingEnabled +.renderer.clippingPlanes
 * ile sol/sağ ayrımı yapılır.
 *
 * Kısayol: Escape → karşılaştırmayı kapat
 */
import * as THREE from "three";
import { $, state } from "../app/state.js";
import { invalidate, onPreRender, offPreRender, applySplitClipToScene } from "../viewer/scene.js";
import { listArchive, loadArchive } from "../api/tauri.js";

// ── Durum ──
let active = false;
let sliderPos = 0.5; // 0–1
let panelEl = null;
let sliderEl = null;
let labelAEl = null;
let labelBEl = null;
let comparisonGroup = null;
let comparisonSurface = null;
let clipPlanes = [];
let sceneClipPlane = null; // Orijinal sahneyi sol tarafta gösteren clip plane
let bound = false;

// ── Kamera senkron kontrolü ──
let cameraLocked = false;
let savedCameraState = null; // { position, target, zoom }

// ── Overlay renk ──
const OVERLAY_TINT = new THREE.Color(0x4a9eff);
const OVERLAY_OPACITY = 0.45;
const Z_SCALE = 10;
// Map A'yı sol tarafta, Map B'yi sağ tarafta gösteren iki zıt clip plane
const CLIP_LEFT = new THREE.Vector3(-1, 0, 0);   // Sol taraf: x < sliderX gösterilir
const CLIP_RIGHT = new THREE.Vector3(1, 0, 0);   // Sağ taraf: x > sliderX gösterilir

// ── Yardımcılar: camelCase + snake_case okuma ──
function v(obj, camel, snake, fallback = 0) {
  return Number(obj?.[camel] ?? obj?.[snake] ?? fallback);
}

// ── Panel ──

function ensurePanel() {
  if (panelEl && panelEl.parentElement) return panelEl;
  panelEl = document.createElement("div");
  panelEl.id = "compare-panel";
  panelEl.style.cssText = `
    position:fixed; top:60px; right:20px; width:340px; max-height:calc(100vh - 80px);
    background:var(--bg-panel, #1a1a2e); border:1px solid var(--border, #333); border-radius:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.5); z-index:9999; overflow-y:auto;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif; color:var(--text, #e0e0e0); display:none;
  `;
  document.body.appendChild(panelEl);
  addStyles();
  return panelEl;
}

function addStyles() {
  if (document.getElementById("compare-styles")) return;
  const style = document.createElement("style");
  style.id = "compare-styles";
  style.textContent = `
    .cmp-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--border, #333); background:var(--bg-header, #16213e); border-radius:12px 12px 0 0; position:sticky; top:0; z-index:1; }
    .cmp-title { font-size:13px; font-weight:600; }
    .cmp-close { background:none; border:none; color:var(--text-muted, #888); font-size:18px; cursor:pointer; padding:0 4px; }
    .cmp-close:hover { color:var(--text, #fff); }
    .cmp-section { padding:10px 14px; border-bottom:1px solid var(--border-dim, #222); }
    .cmp-label { font-size:11px; color:var(--text-accent, #8ea8b8); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px; }
    .cmp-select { width:100%; padding:8px 10px; background:var(--bg-input, #0e1520); border:1px solid var(--border, #333); border-radius:6px; color:var(--text, #e0e0e0); font-size:12px; cursor:pointer; }
    .cmp-select:focus { border-color:#4a9eff; outline:none; }
    .cmp-btn { padding:8px 14px; border:1px solid var(--border, #333); background:var(--bg-input, #0e1520); color:var(--text, #e0e0e0); border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; transition:all 0.15s; width:100%; margin-top:6px; }
    .cmp-btn:hover { background:var(--bg-hover, #1b2a4a); border-color:#4a9eff; }
    .cmp-btn.danger { border-color:#ff4a4a; color:#ff6b6b; }
    .cmp-btn.danger:hover { background:rgba(255,74,74,0.15); }
    .cmp-badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:600; }
    .cmp-badge.a { background:rgba(62,220,140,0.15); color:#3edc8c; }
    .cmp-badge.b { background:rgba(74,158,255,0.15); color:#4a9eff; }
    .cmp-slider-line {
      position:fixed; top:0; bottom:0; width:3px; background:#4a9eff; z-index:9998;
      cursor:ew-resize; pointer-events:auto;
      box-shadow:0 0 8px rgba(74,158,255,0.5);
    }
    .cmp-slider-line.drag { box-shadow:0 0 16px rgba(74,158,255,0.8); width:4px; }
    .cmp-slider-handle {
      position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      width:32px; height:32px; background:var(--bg-panel, #1a1a2e); border:2px solid #4a9eff; border-radius:50%;
      display:flex; align-items:center; justify-content:center; font-size:14px; cursor:ew-resize;
    }
    .cmp-label-tag {
      position:fixed; top:8px; padding:4px 10px; background:rgba(26,26,46,0.9); border-radius:6px;
      font-size:11px; font-weight:600; z-index:9998; pointer-events:none;
    }
    .cmp-label-a { left:12px; color:#3edc8c; border:1px solid rgba(62,220,140,0.3); }
    .cmp-label-b { right:12px; color:#4a9eff; border:1px solid rgba(74,158,255,0.3); }
  `;
  document.head.appendChild(style);
}

async function renderPanel() {
  const panel = ensurePanel();
  if (!active) { panel.style.display = "none"; removeSlider(); return; }

  // Arşiv listesini al
  let archives = [];
  try { archives = await listArchive(); } catch (e) {
    console.warn("[Compare] Arşiv listesi alınamadı:", e);
  }

  const s = state.surfaceState?.structures || {};
  const currentName = state.surfaceState?.fileName || state.surfaceState?.file_name || "Mevcut harita";
  const currentRooms = (s.chambers || []).length;
  const currentTunnels = (s.tunnels || []).length;
  const currentMetals = (s.metals || []).length;

  let archiveOptions = "";
  for (const a of archives) {
    const name = a.fileName || a.file_name || a.id;
    const rooms = a.rooms ?? 0;
    const tunnels = a.tunnels ?? 0;
    const metals = a.metals ?? 0;
    archiveOptions += `<option value="${a.id}">📁 ${name} (${rooms}o/${tunnels}t/${metals}m)</option>`;
  }

  panel.innerHTML = `
    <div class="cmp-header">
      <span class="cmp-title">🔀 Harita Karşılaştırma</span>
      <button class="cmp-close" id="cmp-close">✕</button>
    </div>
    <div class="cmp-section">
      <div class="cmp-label"><span class="cmp-badge a">A</span> Sol taraf — Mevcut harita</div>
      <div style="padding:6px 0;font-size:12px;color:var(--text,#e0e0f4)">${currentName}</div>
      <div style="font-size:11px;color:var(--text-accent,#8ea8b8)">${currentRooms} oda · ${currentTunnels} tünel · ${currentMetals} metal</div>
    </div>
    <div class="cmp-section">
      <div class="cmp-label"><span class="cmp-badge b">B</span> Sağ taraf — Karşılaştırma</div>
      <select class="cmp-select" id="cmp-select-b">
        <option value="">— Harita seçin —</option>
        ${archiveOptions}
      </select>
    </div>
    <div class="cmp-section">
      <button class="cmp-btn" id="cmp-apply">🔀 Karşılaştırmayı Başlat</button>
      <button class="cmp-btn danger" id="cmp-deactivate" style="display:none">✕ Karşılaştırmayı Kapat</button>
    </div>
    <div class="cmp-section" style="font-size:11px;color:var(--text-muted,#5a7080)">
      Slider'ı sürükleyerek iki harita arasında geçiş yapın.<br>
      Escape → kapat · L → kamera kilitle
    </div>
    <div class="cmp-section">
      <div class="cmp-label">📷 Kamera Kontrolü</div>
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="cmp-btn" id="cmp-cam-lock" style="flex:1;margin:0">🔒 Kamera Kilitle</button>
        <button class="cmp-btn" id="cmp-cam-reset" style="flex:1;margin:0">↩️ Sıfırla</button>
      </div>
      <div id="cmp-cam-info" style="margin-top:6px;font-size:10px;color:var(--text-muted,#5a7080)"></div>
    </div>
  `;

  panel.style.display = "block";

  panel.querySelector("#cmp-close")?.addEventListener("click", deactivate);
  panel.querySelector("#cmp-apply")?.addEventListener("click", () => {
    const sel = document.getElementById("cmp-select-b");
    if (sel?.value) startComparison(sel.value);
  });
  panel.querySelector("#cmp-deactivate")?.addEventListener("click", deactivate);
  panel.querySelector("#cmp-cam-lock")?.addEventListener("click", toggleCameraLock);
  panel.querySelector("#cmp-cam-reset")?.addEventListener("click", resetCamera);
  updateCameraInfo();
}

// ── Karşılaştırma ──

async function startComparison(archiveId) {
  if (!state.surfaceState) {
    alert("Önce mevcut haritayı analiz edin.");
    return;
  }
  if (archiveId === "__current__") {
    alert("Lütfen mevcut haritadan farklı bir harita seçin.");
    return;
  }

  let surfaceB;
  try {
    surfaceB = await loadArchive(archiveId);
    if (!surfaceB?.surface) {
      alert("Harita yüklenemedi — surface verisi boş.");
      return;
    }
  } catch (e) {
    alert(`Harita yüklenemedi: ${e}`);
    return;
  }

  // loadArchive { meta, surface: Surface3D, image_base64, ... }
  // Surface3D camelCase: mapWidthM, mapDepthM, structures: { chambers, tunnels, metals }
  comparisonSurface = surfaceB.surface || surfaceB;
  buildComparisonOverlay(comparisonSurface);
  createSlider();
  enableClipping();
  saveCameraState();

  const applyBtn = document.getElementById("cmp-apply");
  const deactivateBtn = document.getElementById("cmp-deactivate");
  if (applyBtn) applyBtn.style.display = "none";
  if (deactivateBtn) deactivateBtn.style.display = "";

  invalidate();
}

// ── 3D overlay build ──

function buildComparisonOverlay(surface) {
  if (!state.scene) return;
  removeComparisonOverlay();

  const structs = surface.structures || {};
  const chambers = structs.chambers || [];
  const tunnels = structs.tunnels || [];
  const metals = structs.metals || [];

  const mapW = v(surface, "mapWidthM", "map_width_m", 24);
  const mapD = v(surface, "mapDepthM", "map_depth_m", 24);

  comparisonGroup = new THREE.Group();
  comparisonGroup.name = "comparisonOverlay";

  // Yarı saydam mavi malzeme (clip plane uygulanacak)
  const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0); // başlangıç, updateSliderPosition'da güncellenir
  clipPlanes = [clipPlane];

  const overlayMat = new THREE.MeshPhongMaterial({
    color: OVERLAY_TINT,
    transparent: true,
    opacity: OVERLAY_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    clippingPlanes: clipPlanes,
    clipShadows: false,
  });

  const wireMat = new THREE.MeshBasicMaterial({
    color: OVERLAY_TINT,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    clippingPlanes: clipPlanes,
  });

  // ── Oda kutuları ──
  for (const ch of chambers) {
    const cx = (v(ch, "cx", "cx") - 0.5) * mapW;
    const cz = (v(ch, "cy", "cy") - 0.5) * mapD;
    const rx = v(ch, "rx", "rx", 0.03) * mapW;
    const ry = v(ch, "ry", "ry", 0.03) * mapD;
    const top = -v(ch, "topFromSurfaceM", "top_from_surface_m", 0.5) * Z_SCALE;
    const height = v(ch, "heightM", "height_m", 2) * Z_SCALE;

    const geo = new THREE.BoxGeometry(rx * 2, height, ry * 2);
    const mesh = new THREE.Mesh(geo, overlayMat);
    mesh.position.set(cx, top - height / 2, cz);
    comparisonGroup.add(mesh);

    const wire = new THREE.Mesh(geo.clone(), wireMat);
    wire.position.copy(mesh.position);
    comparisonGroup.add(wire);
  }

  // ── Tünel silindirleri ──
  for (const t of tunnels) {
    const x0 = (v(t, "x0", "x0") - 0.5) * mapW;
    const z0 = (v(t, "y0", "y0") - 0.5) * mapD;
    const x1 = (v(t, "x1", "x1") - 0.5) * mapW;
    const z1 = (v(t, "y1", "y1") - 0.5) * mapD;
    const floor = -v(t, "floorFromSurfaceM", "floor_from_surface_m", 2) * Z_SCALE;
    const radius = v(t, "widthM", "width_m", 1) * 0.5;

    const midX = (x0 + x1) / 2;
    const midZ = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0) || 0.1;
    const angle = Math.atan2(z1 - z0, x1 - x0);

    const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1, true);
    const mesh = new THREE.Mesh(geo, overlayMat);
    mesh.position.set(midX, floor, midZ);
    mesh.rotation.z = Math.PI / 2;
    mesh.rotation.y = -angle;
    comparisonGroup.add(mesh);
  }

  // ── Metal noktaları ──
  const metalGeo = new THREE.SphereGeometry(0.3, 10, 8);
  for (const m of metals) {
    const mx = (v(m, "cx", "cx") - 0.5) * mapW;
    const mz = (v(m, "cy", "cy") - 0.5) * mapD;
    const md = -v(m, "depthFromSurfaceM", "depth_from_surface_m", 1) * Z_SCALE;
    const mesh = new THREE.Mesh(metalGeo, overlayMat);
    mesh.position.set(mx, md, mz);
    comparisonGroup.add(mesh);
  }

  // ── Zemin overlay ──
  const groundGeo = new THREE.PlaneGeometry(mapW, mapD);
  const groundMat = new THREE.MeshBasicMaterial({
    color: OVERLAY_TINT,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
    clippingPlanes: clipPlanes,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.05;
  comparisonGroup.add(ground);

  state.scene.add(comparisonGroup);
}

function removeComparisonOverlay() {
  clipPlanes = [];
  if (comparisonGroup) {
    comparisonGroup.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose?.();
      }
    });
    state.scene?.remove(comparisonGroup);
    comparisonGroup = null;
  }
  comparisonSurface = null;
}

// ── Kamera kontrolü ──

/** Mevcut kamera durumunu kaydet. */
function saveCameraState() {
  if (!state.camera || !state.controls) return;
  const cam = state.camera;
  const ctrl = state.controls;
  savedCameraState = {
    position: cam.position.clone(),
    target: ctrl.target?.clone?.() || new THREE.Vector3(),
    zoom: cam.zoom ?? 1,
    fov: cam.fov,
  };
}

/** Kamera kilitleme toggle. */
function toggleCameraLock() {
  cameraLocked = !cameraLocked;
  if (!state.controls) return;

  if (cameraLocked) {
    // Kilitle: kontrolcüyü devre dışı bırak
    state.controls.enabled = false;
    // İlk kilitlemede mevcut durumu kaydet
    if (!savedCameraState) saveCameraState();
  } else {
    // Aç: kontrolcüyü tekrar aktifleştir
    state.controls.enabled = true;
  }

  updateCameraLockButton();
  updateCameraInfo();
  invalidate();
}

/** Kamera kilitleme butonunu güncelle. */
function updateCameraLockButton() {
  const btn = document.getElementById("cmp-cam-lock");
  if (!btn) return;
  if (cameraLocked) {
    btn.textContent = "🔓 Kamera Aç";
    btn.style.borderColor = "#22c55e";
    btn.style.color = "#22c55e";
  } else {
    btn.textContent = "🔒 Kamera Kilitle";
    btn.style.borderColor = "";
    btn.style.color = "";
  }
}

/** Kamerayı kayıtlı başlangıç pozisyonuna sıfırla. */
function resetCamera() {
  if (!state.camera || !state.controls) return;

  if (!savedCameraState) {
    // Kayıt yoksa mevcut durumu kaydet ve sıfırlama yapma
    saveCameraState();
    updateCameraInfo();
    return;
  }

  const cam = state.camera;
  const ctrl = state.controls;
  const target = savedCameraState;

  // Yumuşak animasyon (tween)
  const startPos = cam.position.clone();
  const startTarget = ctrl.target?.clone?.() || new THREE.Vector3();
  const startFov = cam.fov;
  const duration = 400; // ms
  const startTime = performance.now();

  function animateReset(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

    cam.position.lerpVectors(startPos, target.position, ease);
    if (ctrl.target?.lerpVectors) {
      ctrl.target.lerpVectors(startTarget, target.target, ease);
    }
    cam.fov = startFov + (target.fov - startFov) * ease;
    cam.updateProjectionMatrix();
    ctrl.update();
    invalidate();

    if (t < 1) requestAnimationFrame(animateReset);
  }
  requestAnimationFrame(animateReset);
}

/** Kamera bilgisini panelde göster. */
function updateCameraInfo() {
  const el = document.getElementById("cmp-cam-info");
  if (!el || !state.camera) return;
  const cam = state.camera;
  el.innerHTML = `Poz: ${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)} | Zoom: ${(cam.zoom ?? 1).toFixed(1)}x | ${cameraLocked ? "🔒 Kilitli" : "🔓 Serbest"}`;
}

// ── Clipping ──

let _lastCamInfoUpdate = 0;
function enableClipping() {
  if (state.renderer) {
    state.renderer.localClippingEnabled = true;
  }
  onPreRender(() => {
    updateClipPlane();
    // Kamera bilgisini periyodik olarak güncelle (500ms throttled)
    const now = performance.now();
    if (now - _lastCamInfoUpdate > 500) {
      _lastCamInfoUpdate = now;
      updateCameraInfo();
    }
  });
  updateClipPlane();
}

function disableClipping() {
  offPreRender(updateClipPlane);
  clipPlanes = [];
  // Orijinal sahnedeki clip plane'leri temizle
  applySplitClipToScene(null);
  sceneClipPlane = null;
  if (comparisonGroup) {
    comparisonGroup.traverse((obj) => {
      if (obj.material?.clippingPlanes) {
        obj.material.clippingPlanes = [];
        obj.material.needsUpdate = true;
      }
    });
  }
}

function updateClipPlane() {
  if (!clipPlanes.length || !state.camera || !state.renderer) return;

  const screenX = sliderPos; // 0–1
  const camera = state.camera;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  // Kameranın sağ eksenini al — kamera döndükçe clip plane de döner
  const right = new THREE.Vector3();
  const viewMatrix = camera.matrixWorldInverse;
  right.setFromMatrixColumn(viewMatrix, 0);

  // Screen X → view space X offset
  const halfFov = (camera.fov * Math.PI) / 360;
  const aspect = camera.aspect || 1;
  const near = camera.near || 0.1;
  const viewX = (screenX * 2 - 1) * Math.tan(halfFov) * aspect * near;

  // World space clip noktası
  const worldPoint = new THREE.Vector3();
  worldPoint.copy(camera.position);
  worldPoint.addScaledVector(right, viewX);
  worldPoint.addScaledVector(dir, near);

  // ── Sağ clip plane (Map B — comparison overlay) ──
  // right normal: x > worldPoint.x gösterilir
  clipPlanes[0].normal.copy(right);
  clipPlanes[0].constant = -right.dot(worldPoint);

  // ── Sol clip plane (Map A — orijinal sahne) ──
  // Ters normal: x < worldPoint.x gösterilir
  if (!sceneClipPlane) {
    sceneClipPlane = new THREE.Plane();
  }
  sceneClipPlane.normal.copy(right).negate(); // -right
  sceneClipPlane.constant = right.dot(worldPoint); // ters işaret

  // Orijinal sahneye sol clip plane uygula
  applySplitClipToScene(sceneClipPlane);

  // Comparison overlay'a sağ clip plane uygula
  if (comparisonGroup) {
    comparisonGroup.traverse((obj) => {
      if (obj.material?.clippingPlanes !== clipPlanes) {
        obj.material.clippingPlanes = clipPlanes;
        obj.material.needsUpdate = true;
      }
    });
  }
}

// ── Slider ──

function createSlider() {
  removeSlider();

  // Slider çizgisi
  sliderEl = document.createElement("div");
  sliderEl.className = "cmp-slider-line";
  sliderEl.innerHTML = '<div class="cmp-slider-handle">⇔</div>';
  document.body.appendChild(sliderEl);

  // Etiketler
  labelAEl = document.createElement("div");
  labelAEl.className = "cmp-label-tag cmp-label-a";
  labelAEl.textContent = "A — Mevcut";
  document.body.appendChild(labelAEl);

  labelBEl = document.createElement("div");
  labelBEl.className = "cmp-label-tag cmp-label-b";
  labelBEl.textContent = "B — Karşılaştırma";
  document.body.appendChild(labelBEl);

  updateSliderPosition();

  // Sürükleme
  let dragging = false;
  sliderEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    sliderEl.classList.add("drag");
    e.preventDefault();
  });

  const onMove = (e) => {
    if (!dragging || !active) return;
    sliderPos = Math.max(0.05, Math.min(0.95, e.clientX / window.innerWidth));
    updateSliderPosition();
  };

  const onUp = () => {
    dragging = false;
    sliderEl?.classList.remove("drag");
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  // Temizlik için sakla
  sliderEl._onMove = onMove;
  sliderEl._onUp = onUp;
}

function removeSlider() {
  if (sliderEl) {
    if (sliderEl._onMove) window.removeEventListener("pointermove", sliderEl._onMove);
    if (sliderEl._onUp) window.removeEventListener("pointerup", sliderEl._onUp);
    sliderEl.remove();
    sliderEl = null;
  }
  if (labelAEl) { labelAEl.remove(); labelAEl = null; }
  if (labelBEl) { labelBEl.remove(); labelBEl = null; }
}

function updateSliderPosition() {
  if (!sliderEl) return;
  const x = sliderPos * window.innerWidth;
  sliderEl.style.left = `${x}px`;
  if (labelAEl) labelAEl.style.left = `${Math.max(12, x - 120)}px`;
  if (labelBEl) labelBEl.style.right = `${Math.max(12, window.innerWidth - x - 120)}px`;
  updateClipPlane();
  invalidate();
}

// ── Açık/Kapalı ──

export async function activate() {
  if (active) return;
  if (!state.surfaceState) {
    alert("Önce bir analiz çalıştırın — karşılaştırma için veri gerekli.");
    return;
  }
  active = true;
  await renderPanel();
  invalidate();
}

export function deactivate() {
  if (!active) return;
  active = false;
  removeComparisonOverlay();
  disableClipping();
  removeSlider();
  if (panelEl) panelEl.style.display = "none";

  // Kamera durumunu sıfırla
  if (cameraLocked && state.controls) {
    state.controls.enabled = true;
  }
  cameraLocked = false;
  savedCameraState = null;

  const applyBtn = document.getElementById("cmp-apply");
  const deactivateBtn = document.getElementById("cmp-deactivate");
  if (applyBtn) applyBtn.style.display = "";
  if (deactivateBtn) deactivateBtn.style.display = "none";

  invalidate();
}

export function isActive() { return active; }

export function toggle() {
  if (active) deactivate();
  else activate();
}

export function bindCompareMode() {
  if (bound) return;
  bound = true;
  window.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape") { deactivate(); e.preventDefault(); }
    if (e.key === "l" || e.key === "L") {
      // Form elemanında odak yoksa kamera kilitle
      const tag = document.activeElement?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        toggleCameraLock();
        e.preventDefault();
      }
    }
  });
  window.addEventListener("resize", () => { if (active) updateSliderPosition(); });
}
