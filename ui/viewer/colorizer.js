/**
 * colorizer.js — Manyetik yoğunluk haritası renklendirme sistemi.
 *
 * Bu modül zemin dokusuna renk haritası bindirir:
 *   1. Manyetik yoğunluk (mavi → kırmızı)
 *   2. Derinlik (sıcak → soğuk)
 *   3. Termal (kızılötesi)
 *   4. Askeri (yeşil tonları)
 *   5. Okyanus (mavi tonları)
 *   6. Mono (gri tonları)
 *   7. Metal Avcısı (altın/beyaz)
 *   8. Kapalı (orijinal görünüm)
 *
 * Tamamen bağımsız modül — silindiğinde hiçbir şey bozulmaz.
 * main.js'den 2 import + 2 event yeterli.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { pushState } from "../ui/undoRedo.js";

/* ── LUT Paletleri ──────────────────────────────────── */

const PALETTES = {
  none: {
    label: "Kapalı",
    stops: null,
  },
  magnetic: {
    label: "Manyetik Yoğunluk",
    stops: [
      { t: 0.0, r: 0, g: 20, b: 80 },
      { t: 0.2, r: 0, g: 80, b: 200 },
      { t: 0.4, r: 0, g: 180, b: 100 },
      { t: 0.6, r: 220, g: 200, b: 0 },
      { t: 0.8, r: 240, g: 80, b: 0 },
      { t: 1.0, r: 200, g: 0, b: 0 },
    ],
  },
  depth: {
    label: "Derinlik Haritası",
    stops: [
      { t: 0.0, r: 20, g: 120, b: 255 },
      { t: 0.3, r: 0, g: 200, b: 180 },
      { t: 0.5, r: 50, g: 220, b: 50 },
      { t: 0.7, r: 240, g: 180, b: 0 },
      { t: 1.0, r: 200, g: 0, b: 80 },
    ],
  },
  thermal: {
    label: "Termal",
    stops: [
      { t: 0.0, r: 0, g: 0, b: 40 },
      { t: 0.2, r: 40, g: 0, b: 120 },
      { t: 0.4, r: 180, g: 0, b: 120 },
      { t: 0.6, r: 240, g: 60, b: 0 },
      { t: 0.8, r: 255, g: 200, b: 0 },
      { t: 1.0, r: 255, g: 255, b: 200 },
    ],
  },
  military: {
    label: "Askeri",
    stops: [
      { t: 0.0, r: 15, g: 25, b: 15 },
      { t: 0.25, r: 30, g: 60, b: 30 },
      { t: 0.5, r: 60, g: 100, b: 40 },
      { t: 0.75, r: 120, g: 130, b: 60 },
      { t: 1.0, r: 180, g: 170, b: 80 },
    ],
  },
  ocean: {
    label: "Okyanus",
    stops: [
      { t: 0.0, r: 0, g: 0, b: 30 },
      { t: 0.2, r: 0, g: 20, b: 100 },
      { t: 0.5, r: 0, g: 80, b: 180 },
      { t: 0.7, r: 0, g: 160, b: 200 },
      { t: 1.0, r: 100, g: 220, b: 240 },
    ],
  },
  mono: {
    label: "Gri Tonları",
    stops: [
      { t: 0.0, r: 0, g: 0, b: 0 },
      { t: 0.5, r: 128, g: 128, b: 128 },
      { t: 1.0, r: 255, g: 255, b: 255 },
    ],
  },
  metal: {
    label: "Metal Avcısı",
    stops: [
      { t: 0.0, r: 20, g: 20, b: 30 },
      { t: 0.3, r: 40, g: 40, b: 50 },
      { t: 0.6, r: 200, g: 160, b: 0 },
      { t: 0.8, r: 255, g: 100, b: 0 },
      { t: 1.0, r: 255, g: 255, b: 255 },
    ],
  },
};

/* ── LUT 256 piksel oluşturucu ─────────────────────── */

function buildLut256(paletteKey) {
  const pal = PALETTES[paletteKey];
  if (!pal || !pal.stops) return null;

  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < pal.stops.length - 2 && pal.stops[j + 1].t < t) j++;
    const s0 = pal.stops[j];
    const s1 = pal.stops[j + 1];
    const range = s1.t - s0.t || 1;
    const f = Math.max(0, Math.min(1, (t - s0.t) / range));
    lut[i * 3] = Math.round(s0.r + (s1.r - s0.r) * f);
    lut[i * 3 + 1] = Math.round(s0.g + (s1.g - s0.g) * f);
    lut[i * 3 + 2] = Math.round(s0.b + (s1.b - s0.b) * f);
  }
  return lut;
}

/* ── Texture Yeniden Renklendirme ──────────────────── */

/**
 * Mevcut ground texture'ı palet LUT'u ile yeniden renklendirir.
 * Orijinal renkler surface.colors'tan okunur — geri dönüşümlü.
 *
 * @param {THREE.Mesh} groundMesh
 * @param {string} paletteKey
 * @returns {boolean} başarı
 */
function remapGroundTexture(groundMesh, paletteKey) {
  if (!groundMesh || !groundMesh.material) return false;

  const lut = buildLut256(paletteKey);
  if (!lut) return false;

  // Orijinal renkleri yüzeyden al
  const surf = state.surfaceState;
  const rawColors = surf?.colors || [];
  if (!rawColors.length) return false;

  const tex = groundMesh.material.map;
  if (!tex || !tex.image) return false;

  // Orijinal renk verisinden yeniden oluştur
  const gw = surf.gridW ?? surf.grid_w ?? 2;
  const gh = surf.gridH ?? surf.grid_h ?? 2;
  const needRgb = gw * gh * 3;
  const data = new Uint8Array(gw * gh * 4);

  for (let i = 0; i < gw * gh; i++) {
    const ri = i * 3;
    const r = Number(rawColors[ri] ?? 40);
    const g = Number(rawColors[ri + 1] ?? 80);
    const b = Number(rawColors[ri + 2] ?? 50);
    // LUT ile yeniden haritala
    data[i * 4] = lut[Math.min(r, 255) * 3];
    data[i * 4 + 1] = lut[Math.min(g, 255) * 3 + 1];
    data[i * 4 + 2] = lut[Math.min(b, 255) * 3 + 2];
    data[i * 4 + 3] = 255;
  }

  // Yeni DataTexture oluştur (orijineli dokunma)
  const newTex = new THREE.DataTexture(data, gw, gh, THREE.RGBAFormat);
  newTex.colorSpace = THREE.SRGBColorSpace;
  newTex.magFilter = THREE.LinearFilter;
  newTex.minFilter = THREE.LinearMipmapLinearFilter;
  newTex.generateMipmaps = true;
  newTex.wrapS = THREE.ClampToEdgeWrapping;
  newTex.wrapT = THREE.ClampToEdgeWrapping;
  newTex.flipY = true;
  newTex.needsUpdate = true;

  // Eski overlay varsa temizle
  if (groundMesh.material._colorizerOverlay) {
    groundMesh.material._colorizerOverlay.dispose();
  }

  // Yeni texture'ı bindir
  groundMesh.material.map = newTex;
  groundMesh.material._colorizerOverlay = newTex;
  groundMesh.material.needsUpdate = true;

  return true;
}

/* ── Orijinale Dönüş ─────────────────────────────── */

function restoreOriginalTexture(groundMesh) {
  if (!groundMesh || !groundMesh.material) return;

  // Overlay varsa temizle
  if (groundMesh.material._colorizerOverlay) {
    groundMesh.material._colorizerOverlay.dispose();
    groundMesh.material._colorizerOverlay = null;
  }

  // Orijinal texture'ı geri yükle
  const origTex = groundMesh.userData?.mapTexture;
  if (origTex) {
    groundMesh.material.map = origTex;
  }
  groundMesh.material.needsUpdate = true;
}

/* ── Public API ────────────────────────────────────── */

/**
 * Renklendirme modunu uygula.
 * @param {string} paletteKey — PALETTES içindeki anahtar
 */
/* ── Palette Change Event ─────────────────────────────── */

/** Palette değişikliği için callback kayıtları */
const _paletteListeners = [];

/**
 * Palette değişikliği için dinleyici ekle.
 * @param {Function} fn — (newPaletteKey, oldPaletteKey) => void
 */
export function onPaletteChange(fn) {
  if (typeof fn === "function") _paletteListeners.push(fn);
}

/**
 * Palette değişikliği olayını tetikle.
 */
function emitPaletteChange(newKey, oldKey) {
  for (const fn of _paletteListeners) {
    try { fn(newKey, oldKey); } catch (e) { console.error("[Colorizer] Palette listener hatası:", e); }
  }
}

export function applyColorizer(paletteKey) {
  const oldKey = state.colorizerMode || "none";
  if (paletteKey !== oldKey) pushState('color-change', { prev: oldKey, next: paletteKey });
  state.colorizerMode = paletteKey;
  const ground = state.groundPlane;
  if (!ground || !ground.material) {
    emitPaletteChange(paletteKey, oldKey);
    return;
  }

  const pal = PALETTES[paletteKey];

  if (!pal || !pal.stops) {
    // Kapalı — orijinale dön
    restoreOriginalTexture(ground);
    invalidate();
    emitPaletteChange(paletteKey, oldKey);
    return;
  }

  const ok = remapGroundTexture(ground, paletteKey);
  if (ok) invalidate();
  emitPaletteChange(paletteKey, oldKey);
}

/**
 * Mevcut renklendirmeyi devre dışı bırak.
 */
export function clearColorizer() {
  applyColorizer("none");
}

/**
 * Bir sonraki renk paletine geç.
 * @returns {string} Yeni aktif palet anahtarı
 */
export function cyclePalette() {
  const keys = Object.keys(PALETTES);
  const current = state.colorizerMode || "none";
  const idx = keys.indexOf(current);
  const next = keys[(idx + 1) % keys.length];
  applyColorizer(next);
  return next;
}

/* ── UI Binding ────────────────────────────────────── */

/**
 * HTML'deki colorizer select'i bu modüle bağlar.
 * main.js'den çağrılır.
 */
export function bindColorizer() {
  const select = document.getElementById("colorizer-palette");
  if (!select) return;

  // Paletleri select'e doldur
  select.innerHTML = "";
  for (const [key, pal] of Object.entries(PALETTES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = pal.label;
    select.appendChild(opt);
  }

  // Kayıtlı tercihi uygula
  select.value = state.colorizerMode || "none";

  select.addEventListener("change", () => {
    applyColorizer(select.value);
  });
}

/**
 * Döngüsel geçiş butonunu bağla.
 */
export function bindColorizerCycle() {
  const btn = document.getElementById("btn-colorizer-cycle");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const key = cyclePalette();
    const pal = PALETTES[key];
    btn.title = `Renk: ${pal?.label || "Kapalı"}`;

    // Select'i de güncelle
    const select = document.getElementById("colorizer-palette");
    if (select) select.value = key;
  });
}

export { PALETTES };
