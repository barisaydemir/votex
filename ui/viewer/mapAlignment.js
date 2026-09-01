/**
 * mapAlignment.js — Harita hizalama ve boyut ayarı.
 *
 * CSV verisi ile görüntü haritası arasındaki yön ve ölçek uyumsuzluğunu
 * çözer. Döndürme, ters çevirme, ölçek ve kaydırma işlemleri uygular.
 *
 * Kullanım:
 *   import { state, getAlignment, applyAlignment, resetAlignment } from "./mapAlignment.js";
 *   // Döndürme ekle
 *   state.csvAlignment.rotation += 90;
 *   applyAlignment(points); // noktalara transform uygula
 */
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { pushState } from "../ui/undoRedo.js";

// ── Varsayılanlar ──
const DEFAULT_ALIGNMENT = {
  rotation: 0,     // derece (0, 90, 180, 270 veya serbest)
  flipX: false,    // yatay ters
  flipZ: false,    // dikey (derinlik) ters
  scaleX: 1.0,     // X ölçek çarpanı
  scaleZ: 1.0,     // Z ölçek çarpanı
  offsetX: 0,      // X kaydırma (metre)
  offsetZ: 0,      // Z kaydırma (metre)
};

// ── State Başlatma ──
if (!state.csvAlignment) {
  state.csvAlignment = { ...DEFAULT_ALIGNMENT };
}

// ── Public API ──

/** Mevcut hizalama değerlerini döndür */
export function getAlignment() {
  return { ...state.csvAlignment };
}

/** Hizalamayı sıfırla */
export function resetAlignment() {
  pushState('alignment', state.csvAlignment);
  Object.assign(state.csvAlignment, { ...DEFAULT_ALIGNMENT });
  console.log('[Align] Hizalama sıfırlandı');
}

/**
 * Tekli transform uygula: rotation, flip, scale, offset.
 * @param {number} x - ham X (metre)
 * @param {number} z - ham Z (metre)
 * @returns {{ x: number, z: number }}
 */
export function transformPoint(x, z) {
  const a = state.csvAlignment;
  let tx = x;
  let tz = z;

  // 1. Ters çevirme (döndürmeden önce)
  if (a.flipX) tx = -tx;
  if (a.flipZ) tz = -tz;

  // 2. Döndürme (radyan)
  const rad = (a.rotation % 360) * Math.PI / 180;
  if (rad !== 0) {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = tx * cos - tz * sin;
    const rz = tx * sin + tz * cos;
    tx = rx;
    tz = rz;
  }

  // 3. Ölçek
  tx *= a.scaleX;
  tz *= a.scaleZ;

  // 4. Kaydırma
  tx += a.offsetX;
  tz += a.offsetZ;

  return { x: tx, z: tz };
}

/**
 * Tüm nokta dizisine transform uygula.
 * @param {Array<{x: number, z: number, ...}>} points
 * @returns {Array} transform edilmiş noktalar (orijinalleri değiştirmez)
 */
export function applyAlignment(points) {
  if (!points || !points.length) return points;

  const a = state.csvAlignment;
  // Hız optimizasyonu: hiçbir transform yoksa orijinali döndür
  const hasTransform =
    a.rotation !== 0 || a.flipX || a.flipZ ||
    a.scaleX !== 1 || a.scaleZ !== 1 ||
    a.offsetX !== 0 || a.offsetZ !== 0;

  if (!hasTransform) return points;

  return points.map(p => {
    const { x, z } = transformPoint(p.x, p.z);
    return { ...p, x, z };
  });
}

/**
 * Hızlı döndürme: belirli açıya ayarla.
 * @param {number} angle - 0, 90, 180, 270
 */
export function setRotation(angle) {
  pushState('alignment', state.csvAlignment);
  state.csvAlignment.rotation = ((angle % 360) + 360) % 360;
  console.log(`[Align] Döndürme: ${state.csvAlignment.rotation}°`);
}

/**
 * Döndürmeyi derece olarak ayarla (serbest açı).
 * @param {number} degrees
 */
export function setRotationFree(degrees) {
  state.csvAlignment.rotation = ((degrees % 360) + 360) % 360;
}

/** Yatay ters çevir */
export function toggleFlipX() {
  pushState('alignment', state.csvAlignment);
  state.csvAlignment.flipX = !state.csvAlignment.flipX;
  console.log(`[Align] Yatay ters: ${state.csvAlignment.flipX}`);
}

/** Dikey ters çevir */
export function toggleFlipZ() {
  pushState('alignment', state.csvAlignment);
  state.csvAlignment.flipZ = !state.csvAlignment.flipZ;
  console.log(`[Align] Dikey ters: ${state.csvAlignment.flipZ}`);
}

/**
 * Manuel ölçek ayarla.
 * @param {number} sx - X ölçek (0.1..10)
 * @param {number} sz - Z ölçek (0.1..10)
 */
let _scaleUndoPending = false;
export function setScale(sx, sz) {
  if (!_scaleUndoPending) { pushState('alignment', state.csvAlignment); _scaleUndoPending = true; setTimeout(() => _scaleUndoPending = false, 500); }
  state.csvAlignment.scaleX = Math.max(0.1, Math.min(10, sx));
  state.csvAlignment.scaleZ = Math.max(0.1, Math.min(10, sz));
}

/**
 * Manuel kaydırma ayarla.
 * @param {number} ox - X offset (metre)
 * @param {number} oz - Z offset (metre)
 */
let _offsetUndoPending = false;
export function setOffset(ox, oz) {
  if (!_offsetUndoPending) { pushState('alignment', state.csvAlignment); _offsetUndoPending = true; setTimeout(() => _offsetUndoPending = false, 500); }
  state.csvAlignment.offsetX = ox;
  state.csvAlignment.offsetZ = oz;
}

/**
 * Otomatik sığdırma: CSV sınırlarını havuz boyutuna sığdır.
 * @param {{ xMin, xMax, zMin, zMax }} csvBounds - CSV metre sınırları
 * @param {number} poolSize - havuz boyutu (metre)
 * @param {number} fitFactor - sığdırma payı (0..1, varsayılan 0.85)
 */
export function autoFit(csvBounds, poolSize, fitFactor = 0.85) {
  const csvW = (csvBounds.xMax - csvBounds.xMin) || 1;
  const csvD = (csvBounds.zMax - csvBounds.zMin) || 1;
  const targetW = poolSize * fitFactor;
  const targetD = poolSize * fitFactor;

  state.csvAlignment.scaleX = targetW / csvW;
  state.csvAlignment.scaleZ = targetD / csvD;
  state.csvAlignment.offsetX = 0;
  state.csvAlignment.offsetZ = 0;
  state.csvAlignment.rotation = 0;
  state.csvAlignment.flipX = false;
  state.csvAlignment.flipZ = false;

  console.log(`[Align] Otomatik sığdırma: scaleX=${state.csvAlignment.scaleX.toFixed(3)}, scaleZ=${state.csvAlignment.scaleZ.toFixed(3)}`);
}

// ── Karşılaştırma Overlay State ──
export const compareMode = {
  enabled: false,
  type: 'blend',     // 'split' | 'blend' | 'grid'
  blendOpacity: 0.5, // bindirme opaklığı (0..1)
  splitPos: 0.5,     // split çizgisi pozisyonu (0..1)
};

/**
 * Karşılaştırma modunu ayarla.
 * @param {string} type - 'split' | 'blend' | 'grid' | null (kapat)
 */
export function setCompareMode(type) {
  compareMode.enabled = !!type;
  compareMode.type = type || 'blend';
  if (type === 'split') compareMode.splitPos = 0.5;
  if (type === 'blend') compareMode.blendOpacity = 0.5;
  console.log(`[Align] Karşılaştırma modu: ${type || 'kapalı'}`);
}

/** Bindirme opaklığını ayarla (0..1) */
export function setBlendOpacity(v) {
  compareMode.blendOpacity = Math.max(0, Math.min(1, v));
}

/** Split çizgisi pozisyonunu ayarla (0..1) */
export function setSplitPos(v) {
  compareMode.splitPos = Math.max(0, Math.min(1, v));
}

// ── Durum Özeti ──
export function getAlignmentStatus() {
  const a = state.csvAlignment;
  const parts = [];
  if (a.rotation !== 0) parts.push(`${a.rotation}°`);
  if (a.flipX) parts.push('yatay-ter');
  if (a.flipZ) parts.push('dikey-ter');
  if (a.scaleX !== 1 || a.scaleZ !== 1) parts.push(`ölçek:${a.scaleX.toFixed(2)}x${a.scaleZ.toFixed(2)}`);
  if (a.offsetX !== 0 || a.offsetZ !== 0) parts.push(`kaydır:${a.offsetX.toFixed(1)},${a.offsetZ.toFixed(1)}`);
  return parts.length ? parts.join(' · ') : 'normal';
}
