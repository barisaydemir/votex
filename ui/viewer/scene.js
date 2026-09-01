import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { $, state } from "../app/state.js";
import { initStageHud, updateStageHud } from "../ui/stageHud.js";
import { updateLabelFade, invalidateLabelCache } from "./labelFade.js";
import { noteRenderFrame, onTierChange } from "./adaptiveQuality.js";


// ── Render-on-demand ─────────────────────────────────────────
// Sahne değişmedikçe GPU boşa çalışmaz: invalidate() bir kare çizim
// talep eder; tick() yalnızca çizim gerekirken döngüyü canlı tutar.
let rafId = null;
let needsRender = false;
let _lastClipConstant = NaN;

// ── Pre-render hooks ──────────────────────────────────────────
// Dairesel bağımlılık olmadan modüllerin her kare öncesi
// çalışmasını sağlar (ör. compareMode clip plane güncelleme).
const _preRenderHooks = [];
export function onPreRender(fn) { _preRenderHooks.push(fn); }
export function offPreRender(fn) {
  const i = _preRenderHooks.indexOf(fn);
  if (i >= 0) _preRenderHooks.splice(i, 1);
}

/** Sahne/kamera değişti → bir kare çiz. Tüm mutasyon noktaları bunu çağırır. */
export function invalidate() {
  needsRender = true;
  if (rafId == null) rafId = requestAnimationFrame(tick);
}

// ── Kesit (clipping) modu ────────────────────────────────────
// Zemini yatay düzlemle keser: yapılar kesitsiz kalır, toprak “soyulur”.
// Düzlem: normal (0,−1,0) + constant h → y ≤ h korunur.
export const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);

function refreshClipState() {
  const c = Number(state.clipHeightM) || 0;
  clipPlane.constant = c;
  const planes = state.clipEnabled ? [clipPlane] : null;
  if (c === _lastClipConstant && !!state.groundPlane?.material.clippingPlanes === !!planes) return;
  _lastClipConstant = c;
  // Zemin + grid
  if (state.groundPlane?.material) {
    state.groundPlane.material.clippingPlanes = planes;
    state.groundPlane.material.clipShadows = true;
    state.groundPlane.material.needsUpdate = true;
  }
  const grid = state.scene?.getObjectByName("meterGrid");
  if (grid?.material) {
    grid.material.clippingPlanes = planes;
    grid.material.needsUpdate = true;
  }
  // Tüm yapı mesh'lerine uygula (structureGroup içindeki)
  if (state.structureGroup) {
    state.structureGroup.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.clippingPlanes = planes;
        obj.material.clipShadows = true;
        obj.material.needsUpdate = true;
      }
    });
  }
  // Manyetik zemin overlay'e uygula
  if (state.groundMagneticOverlay?.material) {
    state.groundMagneticOverlay.material.clippingPlanes = planes;
    state.groundMagneticOverlay.material.needsUpdate = true;
  }
}

/**
 * Karşılaştırma split clip plane'lerini orijinal sahne malzemelerine uygula.
 * compareMode.js slider her hareket ettiğinde çağrılır.
 * Sol taraftaki yapıları (Map A) gösterir, sağ tarafı kırpır.
 */
export function applySplitClipToScene(clipPlane) {
  const planes = clipPlane ? [clipPlane] : null;
  // Zemin + grid
  if (state.groundPlane?.material) {
    state.groundPlane.material.clippingPlanes = planes;
    state.groundPlane.material.needsUpdate = true;
  }
  const grid = state.scene?.getObjectByName("meterGrid");
  if (grid?.material) {
    grid.material.clippingPlanes = planes;
    grid.material.needsUpdate = true;
  }
  // Tüm yapı mesh'leri
  if (state.structureGroup) {
    state.structureGroup.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.clippingPlanes = planes;
        obj.material.needsUpdate = true;
      }
    });
  }
}

export function setClipEnabled(on) {
  state.clipEnabled = !!on;
  refreshClipState();
  invalidate();
}

export function setClipHeight(m) {
  state.clipHeightM = Number(m) || 0;
  if (state.clipEnabled) {
    refreshClipState();
    invalidate();
  }
}

/** Harita derinliğine göre kesit slider aralığını güncelle. */
export function syncClipRange(yMin, yMax) {
  const slider = $("clip-height");
  if (!slider) return;
  slider.min = String(Math.floor(yMin));
  slider.max = String(Math.ceil(yMax));
  const v = Math.min(Math.max(Number(slider.value) || state.clipHeightM, yMin), yMax);
  slider.value = String(v);
  state.clipHeightM = v;
  const label = $("clip-height-label");
  if (label) label.textContent = `${v} m`;
  refreshClipState();
}

function tick() {
  // rafId = null: draw=false iken döngüyü durdur; draw=true iken zaten
  // aşağıdaki rAF satırı yeni bir rafId atayacak.
  // Tier change listener isValid() çağırırsa needsRender'i true yapar
  // → bir sonraki kare çizilir.
  const moved = state.controls ? state.controls.update() === true : false;
  const draw = needsRender || moved;
  needsRender = false;
  if (draw && state.renderer && state.scene && state.camera) {
    rafId = requestAnimationFrame(tick); // döngüyü önce canlandır (invalidate() binden korur)
    updateStageHud();
    updateLabelFade();
    for (const fn of _preRenderHooks) { try { fn(); } catch (_) {} }
    state.renderer.render(state.scene, state.camera);
    if (noteRenderFrame(performance.now())) {
      needsRender = true;
    }
  } else {
    rafId = null; // çizim yok → döngüyü durdur
  }
}

export function ensureViewer() {
  const host = $("viewer");
  if (state.renderer) return;

  const w = host.clientWidth || 640;
  const h = host.clientHeight || 480;

  state.renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(w, h);
  state.renderer.setClearColor(0x080c10, 1);
  // Sinematik renk: ACES filmik tone mapping
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.06;
  // Kesit (clipping) düzlemleri malzeme bazında çalışsın
  state.renderer.localClippingEnabled = true;
  // Yapı silüetleri için gölge
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(state.renderer.domElement);

  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.Fog(0x080c10, 45, 160);

  // Sıfır asset ile PBR ortam yansıması (metal/plume malzemelerini canlandırır)
  try {
    const pmrem = new THREE.PMREMGenerator(state.renderer);
    state.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    state.scene.environmentIntensity = 0.35; // ışıklar baskın kalsın
    pmrem.dispose();
  } catch (e) {
    console.warn("[Viewer] RoomEnvironment kurulamadı:", e);
  }

  state.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
  state.camera.position.set(26, 18, 30);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.target.set(0, -6, 0);
  // Sürükleme/damping sırasında her değişimde kare çiz
  state.controls.addEventListener("change", invalidate);

  state.scene.add(new THREE.HemisphereLight(0xb8d4c0, 0x101820, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(18, 28, 12);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  Object.assign(dir.shadow.camera, {
    left: -80,
    right: 80,
    top: 80,
    bottom: -80,
    near: 1,
    far: 260,
  });
  dir.shadow.bias = -0.0005;
  dir.shadow.normalBias = 0.03;
  state.sunLight = dir; // mesh.js harita boyutuna göre gölge kutusunu daraltır
  state.scene.add(dir);
  state.scene.add(dir.target);
  state.scene.add(new THREE.AmbientLight(0x3a4a55, 0.4));

  initStageHud();
  // Canlı koordinat okuma (mouse XYZ + manyetik)
  import("./liveProbe.js").then(m => m.initLiveProbe(host)).catch(() => {});
  window.addEventListener("resize", onResize);
  onTierChange(() => invalidate()); // kademe değişiminde güvenli yeniden çizim
  invalidate();
}

export function onResize() {
  if (!state.renderer || !state.camera) return;
  const host = $("viewer");
  const w = host.clientWidth || 640;
  const h = host.clientHeight || 480;
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h);
  invalidate();
}

export { refreshClipState };

export function clearStructures() {
  invalidateLabelCache(); // sprite listesi artık geçersiz
  state.structureTargets = {};
  state.freeDrawTargets = {};
  state.freeDrawItems = [];
  state.selectedFreeDrawId = null;
  state.selectedStructureId = null;
  if (state.selectionMarker && state.scene) {
    state.scene.remove(state.selectionMarker);
    state.selectionMarker.geometry?.dispose();
    state.selectionMarker.material?.dispose();
    state.selectionMarker = null;
  }
  if (state.structureGroup) {
    state.structureGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        // Paylaşılan x-ray materyalleri dispose etme (önbellekte yeniden kullanılır)
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.userData?.votexXrayShared || m.dispose());
        else if (!obj.material.userData?.votexXrayShared) obj.material.dispose();
      }
    });
    state.scene.remove(state.structureGroup);
    state.structureGroup = null;
  }
  if (state.freeDrawGroup) {
    state.freeDrawGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.userData?.votexXrayShared || m.dispose());
        else if (!obj.material.userData?.votexXrayShared) obj.material.dispose();
      }
    });
    state.scene.remove(state.freeDrawGroup);
    state.freeDrawGroup = null;
  }
  if (state.groundPlane) {
    state.scene.remove(state.groundPlane);
    // disposeGround textures + geom
    const g = state.groundPlane;
    g.geometry?.dispose();
    const tex = g.userData?.mapTexture;
    if (tex) tex.dispose();
    if (g.material) {
      if (Array.isArray(g.material)) g.material.forEach((m) => m.dispose());
      else g.material.dispose();
    }
    state.groundPlane = null;
  }
  if (state.csvOverlay) {
    state.csvOverlay.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    state.scene.remove(state.csvOverlay);
    state.csvOverlay = null;
  }
  invalidate();
}
