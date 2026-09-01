/**
 * groundMagneticOverlay.js — 3D ground plane üzerine manyetik yoğunluk haritası.
 *
 * CSV manyetik değerlerini XZ zemin yüzeyine yarı saydam jet renk
 * skalasıyla (mavi→kırmızı) dokunarak haritalandırır.
 * Böylece yer yüzünde manyetik yoğunluk okunabilir hâle gelir.
 *
 * Kullanım:
 *   import { updateGroundMagneticOverlay } from "./groundMagneticOverlay.js";
 *   updateGroundMagneticOverlay(csvGroup, surface);
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

// ── Sabitler ──
const OVERLAY_GRID = 128;           // Heatmap çözünürlüğü (128×128 piksel)
const OVERLAY_Y_BIAS = 0.02;        // Z-fighting önleme: zeminin hemen üstü
const DEFAULT_OPACITY = 0.45;       // Varsayılan opaklık

// ── Jet Colormap ──
const JET_STOPS = [
  { t: 0.00, r: 0,   g: 0,   b: 128 },
  { t: 0.12, r: 0,   g: 0,   b: 255 },
  { t: 0.30, r: 0,   g: 255, b: 255 },
  { t: 0.45, r: 0,   g: 255, b: 0   },
  { t: 0.55, r: 255, g: 255, b: 0   },
  { t: 0.75, r: 255, g: 128, b: 0   },
  { t: 1.00, r: 255, g: 0,   b: 0   },
];

function jetRgb(t) {
  // t: 0..1 → [r,g,b]
  const n = Math.max(0, Math.min(1, t));
  let lo = JET_STOPS[0], hi = JET_STOPS[JET_STOPS.length - 1];
  for (let i = 0; i < JET_STOPS.length - 1; i++) {
    if (n >= JET_STOPS[i].t && n <= JET_STOPS[i + 1].t) {
      lo = JET_STOPS[i]; hi = JET_STOPS[i + 1]; break;
    }
  }
  const f = (hi.t - lo.t) > 0 ? (n - lo.t) / (hi.t - lo.t) : 0;
  return [
    Math.round(lo.r + (hi.r - lo.r) * f),
    Math.round(lo.g + (hi.g - lo.g) * f),
    Math.round(lo.b + (hi.b - lo.b) * f),
  ];
}

// ── Grid Binning ──

/**
 * CSV noktalarını XZ düzlemine 2D grid'e binning yapar.
 * Y ekseni (derinlik) yok sayılır — manyetik yoğunluk sadece XZ'de gösterilir.
 */
function binToGroundGrid(points, mapW, mapD, gridRes) {
  const n = gridRes * gridRes;
  const sums = new Float64Array(n);
  const counts = new Uint32Array(n);
  const halfW = mapW / 2;
  const halfD = mapD / 2;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // Normalize coords → grid indeks
    const gx = Math.floor(((p.x + halfW) / mapW) * (gridRes - 1));
    const gz = Math.floor(((p.z + halfD) / mapD) * (gridRes - 1));
    if (gx < 0 || gz < 0 || gx >= gridRes || gz >= gridRes) continue;
    const idx = gz * gridRes + gx;
    sums[idx] += (p.magnetic ?? p.anomaly ?? 0);
    counts[idx]++;
  }

  const grid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    grid[i] = counts[i] > 0 ? sums[i] / counts[i] : NaN;
  }
  return { grid, counts, gridRes };
}

/**
 * Grid'i RGBA DataTexture'a dönüştürür.
 * Boş hücreler saydam, dolu hücreler jet renkli.
 */
function gridToTexture(grid, counts, gridRes) {
  const n = gridRes * gridRes;
  const data = new Uint8Array(n * 4);

  // İstatistikleri hesapla (sadece dolu hücreler)
  let mMin = Infinity, mMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (counts[i] > 0 && Number.isFinite(grid[i])) {
      if (grid[i] < mMin) mMin = grid[i];
      if (grid[i] > mMax) mMax = grid[i];
    }
  }
  if (!Number.isFinite(mMin)) { mMin = -100; mMax = 100; }
  const mRange = (mMax - mMin) || 1;

  for (let i = 0; i < n; i++) {
    const off = i * 4;
    if (counts[i] === 0 || !Number.isFinite(grid[i])) {
      data[off] = 0; data[off + 1] = 0; data[off + 2] = 0; data[off + 3] = 0;
    } else {
      const t = (grid[i] - mMin) / mRange;
      const [r, g, b] = jetRgb(t);
      data[off] = r; data[off + 1] = g; data[off + 2] = b; data[off + 3] = 200;
    }
  }

  const tex = new THREE.DataTexture(data, gridRes, gridRes, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

// ── Ana Fonksiyon ──

/**
 * CSV overlay group'tan manyetik zemin haritası oluşturur.
 *
 * @param {THREE.Group} csvGroup - csvOverlay'den dönen 3D group
 * @param {Object} surface - Harita yüzeyi (mapWidthM, mapDepthM vb.)
 * @param {Object} opts - { opacity, gridRes, visible }
 * @returns {THREE.Mesh|null} Overlay mesh veya null
 */
export function buildGroundMagneticOverlay(csvGroup, surface, opts = {}) {
  if (!csvGroup || !surface) return null;

  // CSV group'tan normalize edilmiş noktaları al
  const normPoints = csvGroup.userData?.csvPoints;
  if (!normPoints || normPoints.length === 0) return null;

  const mapW = Number(surface.mapWidthM ?? surface.map_width_m ?? surface.mapSizeM ?? 24);
  const mapD = Number(surface.mapDepthM ?? surface.map_depth_m ?? mapW);
  const gridRes = opts.gridRes || OVERLAY_GRID;
  const opacity = opts.opacity ?? state.magneticOverlayOpacity ?? DEFAULT_OPACITY;

  // XZ düzlemine binning
  const { grid, counts } = binToGroundGrid(normPoints, mapW, mapD, gridRes);

  // Boş hücre oranı çok yüksekse atla (veri yok)
  let filledCount = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) filledCount++;
  if (filledCount < 10) {
    console.log("[GroundMagOverlay] Yeterli veri yok, overlay atlandı");
    return null;
  }

  // Texture oluştur
  const tex = gridToTexture(grid, counts, gridRes);

  // Ground plane geometry ile aynı boyutta mesh
  const geo = new THREE.PlaneGeometry(mapW, mapD);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "groundMagneticOverlay";
  mesh.position.y = OVERLAY_Y_BIAS;
  mesh.renderOrder = 1; // Zeminin biraz önünde rendersun
  mesh.userData.votexLayer = "csv";

  console.log(`[GroundMagOverlay] Oluşturuldu: ${gridRes}×${gridRes} grid, ${filledCount} hücre dolu, opacity=${opacity}`);

  return mesh;
}

// ── Sahne Yönetimi ──

/**
 * Manyetik zemin overlay'ı sahneye ekler veya günceller.
 * csvOverlay yüklendiğinde çağrılır.
 *
 * @param {THREE.Group} csvGroup
 * @param {Object} surface
 */
export function updateGroundMagneticOverlay(csvGroup, surface) {
  const scene = state.scene;
  if (!scene) return;

  // Eski overlay'ı kaldır
  removeGroundMagneticOverlay();

  if (!state.showMagneticGround) return;

  const mesh = buildGroundMagneticOverlay(csvGroup, surface);
  if (!mesh) return;

  scene.add(mesh);
  state.groundMagneticOverlay = mesh;
  invalidate();
}

/**
 * Manyetik zemin overlay'ı sahneyeden kaldırır.
 */
export function removeGroundMagneticOverlay() {
  const old = state.groundMagneticOverlay;
  if (old) {
    if (old.geometry) old.geometry.dispose();
    if (old.material) {
      if (old.material.map) old.material.map.dispose();
      old.material.dispose();
    }
    state.scene?.remove(old);
    state.groundMagneticOverlay = null;
  }
}

/**
 * Opaklığı ayarla (0..1).
 */
export function setMagneticOverlayOpacity(value) {
  state.magneticOverlayOpacity = Math.max(0, Math.min(1, value));
  if (state.groundMagneticOverlay?.material) {
    state.groundMagneticOverlay.material.opacity = state.magneticOverlayOpacity;
    invalidate();
  }
}

/**
 * Manyetik overlay görünürlüğünü aç/kapa.
 */
export function toggleMagneticGround(show) {
  state.showMagneticGround = show;
  if (state.groundMagneticOverlay) {
    state.groundMagneticOverlay.visible = show;
    invalidate();
  }
}

/**
 * Kesit plane ile senkronize et.
 */
export function syncMagneticOverlayClip() {
  const overlay = state.groundMagneticOverlay;
  if (!overlay?.material) return;
  const planes = state.clipEnabled ? [state.clipPlane] : null;
  overlay.material.clippingPlanes = planes;
  overlay.material.needsUpdate = true;
}
