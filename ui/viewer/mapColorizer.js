/**
 * mapColorizer.js — 2D Harita Önizleme Renklendirme
 *
 * Analizden ÖNCE renk şeması uygular:
 *   1. Ham ELIC görselini canvas'a çizer
 *   2. Seçilen palet LUT ile her pikseli yeniden renklendirir
 *   3. Renklendirilmiş sonucu overlay canvas'ta gösterir
 *   4. Ham görsel her zaman korunur → geri dönüşümlü
 *
 * Tamamen bağımsız modül — silindiğinde hiçbir şey bozulmaz.
 */
import { $, state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { pushState } from "../ui/undoRedo.js";
import { PALETTES } from "./colorizer.js";

/* ── LUT 256 Piksel Oluşturucu ─────────────────────── */

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

/* ── Durum ─────────────────────────────────────────── */

/** Orijinal ham görsel base64 — geri dönüş için saklanır */
let _rawImageBase64 = null;

/** Şu anki aktif renk şeması (2D) */
let _activePalette = "none";

/** Overlay canvas elementi (gösterilen) */
let _overlayCanvas = null;

/** İkinci overlay canvas (crossfade için gelen) */
let _overlayNextCanvas = null;

/** Offscreen canvas (LUT uygulamak için) */
let _offscreenCanvas = null;
let _offscreenCtx = null;

/** Crossfade animasyon durumu */
let _crossfadeRAF = null;
let _crossfadeOldCanvas = null;
let _crossfadeNewCanvas = null;

/* ── Overlay Canvas Management ─────────────────────── */

const OVERLAY_STYLE =
  "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;display:none;image-rendering:auto;";

/**
 * Overlay canvas'ı al veya oluştur.
 * @param {boolean} [next=false] — crossfade için ikinci canvas mı
 */
function getOverlayCanvas(next = false) {
  if (next) {
    if (_overlayNextCanvas) return _overlayNextCanvas;
    const wrap = document.getElementById("preview-wrap");
    if (!wrap) return null;
    _overlayNextCanvas = document.createElement("canvas");
    _overlayNextCanvas.id = "preview-colorized-next";
    _overlayNextCanvas.setAttribute("aria-hidden", "true");
    _overlayNextCanvas.style.cssText = OVERLAY_STYLE + "z-index:6;";
    wrap.appendChild(_overlayNextCanvas);
    return _overlayNextCanvas;
  }
  if (_overlayCanvas) return _overlayCanvas;

  const wrap = document.getElementById("preview-wrap");
  if (!wrap) return null;

  _overlayCanvas = document.createElement("canvas");
  _overlayCanvas.id = "preview-colorized";
  _overlayCanvas.setAttribute("aria-hidden", "true");
  _overlayCanvas.style.cssText = OVERLAY_STYLE;
  wrap.appendChild(_overlayCanvas);

  return _overlayCanvas;
}

/**
 * Offscreen canvas'ı al veya oluştur.
 */
function getOffscreen(w, h) {
  if (!_offscreenCanvas || _offscreenCanvas.width !== w || _offscreenCanvas.height !== h) {
    _offscreenCanvas = document.createElement("canvas");
    _offscreenCanvas.width = w;
    _offscreenCanvas.height = h;
    _offscreenCtx = _offscreenCanvas.getContext("2d", { willReadFrequently: true });
  }
  return { canvas: _offscreenCanvas, ctx: _offscreenCtx };
}

/* ── 2D Renklendirme ───────────────────────────────── */

/**
 * Bir palet için renklendirilmiş canvas render'ı oluştur.
 * @param {string} paletteKey
 * @returns {HTMLCanvasElement|null} boyutlandırılmış canvas (w×h)
 */
function renderPaletteCanvas(paletteKey) {
  const imgEl = document.getElementById("preview");
  if (!imgEl || !imgEl.naturalWidth) return null;

  const lut = buildLut256(paletteKey);
  if (!lut) return null;

  const w = imgEl.naturalWidth;
  const h = imgEl.naturalHeight;
  if (w < 4 || h < 4) return null;

  const { canvas: offC, ctx: offCtx } = getOffscreen(w, h);
  offCtx.clearRect(0, 0, w, h);
  offCtx.drawImage(imgEl, 0, 0, w, h);

  let imageData;
  try {
    imageData = offCtx.getImageData(0, 0, w, h);
  } catch (e) {
    console.warn("[MapColorizer] Canvas read hatası:", e);
    return null;
  }

  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    data[i] = lut[Math.min(r, 255) * 3];
    data[i + 1] = lut[Math.min(r, 255) * 3 + 1];
    data[i + 2] = lut[Math.min(r, 255) * 3 + 2];
  }

  offCtx.putImageData(imageData, 0, 0);

  // Yeni canvas'a kopyala
  const result = document.createElement("canvas");
  result.width = w;
  result.height = h;
  result.getContext("2d").drawImage(offC, 0, 0);
  return result;
}

/**
 * Crossfade animasyonu.
 * Eski canvas'tan yeni canvas'a yumuşak geçiş.
 *
 * @param {HTMLCanvasElement} fromCanvas — şu an görünen
 * @param {HTMLCanvasElement} toCanvas — geçilecek olan
 * @param {HTMLCanvasElement} targetOverlay — animasyon sonunda kalıcı olacak overlay
 * @param {number} [duration=250] — ms
 */
function crossfade(fromCanvas, toCanvas, targetOverlay, duration = 250) {
  // Önceki animasyon varsa iptal et
  if (_crossfadeRAF) {
    cancelAnimationFrame(_crossfadeRAF);
    _crossfadeRAF = null;
  }

  const startTime = performance.now();

  // Eski canvas'ı konumlandır (alt katman)
  fromCanvas.style.cssText = OVERLAY_STYLE + "z-index:5;opacity:1;";
  // Yeni canvas'ı konumlandır (üst katman)
  toCanvas.style.cssText = OVERLAY_STYLE + "z-index:6;opacity:0;";

  // Her ikisini de göster
  fromCanvas.style.display = "";
  toCanvas.style.display = "";

  function tick(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    // Ease-out quad — başta hızlı, sonda yavaş
    const ease = 1 - (1 - t) * (1 - t);

    fromCanvas.style.opacity = String(1 - ease);
    toCanvas.style.opacity = String(ease);

    if (t < 1) {
      _crossfadeRAF = requestAnimationFrame(tick);
    } else {
      // Animasyon bitti — yeni canvas'ı kalıcı overlay'a kopyala
      const ctx = targetOverlay.getContext("2d");
      targetOverlay.width = toCanvas.width;
      targetOverlay.height = toCanvas.height;
      ctx.drawImage(toCanvas, 0, 0);
      targetOverlay.style.display = "";
      targetOverlay.style.opacity = String(_overlayOpacity);
      targetOverlay.style.zIndex = "5";

      // Eski canvas'ı gizle
      fromCanvas.style.display = "none";
      fromCanvas.style.opacity = "0";

      _crossfadeRAF = null;
      _crossfadeOldCanvas = null;
      _crossfadeNewCanvas = null;
    }
  }

  _crossfadeRAF = requestAnimationFrame(tick);
}

/**
 * Mevcut overlay'ı bir canvas'a kopyala (crossfade için "eski" olarak).
 * @param {HTMLCanvasElement} target — kopyalanacak hedef canvas
 */
function snapshotCurrentOverlay(target) {
  const current = getOverlayCanvas(false);
  if (!current || current.style.display === "none" || !current.width) return;
  target.width = current.width;
  target.height = current.height;
  target.getContext("2d").drawImage(current, 0, 0);
  target.style.display = "";
  target.style.opacity = "1";
}

/**
 * Seçili paleti 2D harita önizlemesine uygula.
 * Crossfade animasyonuyla geçiş yapar.
 *
 * @param {string} paletteKey — PALETTES içindeki anahtar
 * @returns {boolean} başarı
 */
export function apply2DColorizer(paletteKey) {
  const imgEl = document.getElementById("preview");
  if (!imgEl || !imgEl.naturalWidth) return false;

  // Ham görseli sakla (ilk kez)
  if (!_rawImageBase64 && state.pendingFile?.base64) {
    _rawImageBase64 = state.pendingFile.base64;
  }

  const overlay = getOverlayCanvas(false);
  if (!overlay) return false;

  // "Kapalı" → orijinale dön (crossfade ile)
  if (!paletteKey || paletteKey === "none") {
    return restore2DOriginal();
  }

  const lut = buildLut256(paletteKey);
  if (!lut) return false;

  const w = imgEl.naturalWidth;
  const h = imgEl.naturalHeight;
  if (w < 4 || h < 4) return false;

  // Yeni paleti render et
  const nextCanvas = renderPaletteCanvas(paletteKey);
  if (!nextCanvas) return false;

  // Mevcut overlay'da bir şey varsa crossfade yap
  const hasExisting = overlay.style.display !== "none" && overlay.width > 0 && _activePalette !== "none";

  if (hasExisting) {
    // Eski durumun snapshot'ını al
    const oldSnapshot = document.createElement("canvas");
    snapshotCurrentOverlay(oldSnapshot);

    // Crossfade: eski → yeni
    const nextOverlay = getOverlayCanvas(true);
    if (nextOverlay) {
      nextOverlay.width = nextCanvas.width;
      nextOverlay.height = nextCanvas.height;
      nextOverlay.getContext("2d").drawImage(nextCanvas, 0, 0);
      crossfade(oldSnapshot, nextOverlay, overlay);
    }
  } else {
    // İlk kez uygulama — direkt göster (crossfade yok)
    overlay.width = w;
    overlay.height = h;
    overlay.getContext("2d").drawImage(nextCanvas, 0, 0);
    overlay.style.display = "";
    overlay.style.opacity = String(_overlayOpacity);
  }

  _activePalette = paletteKey;
  return true;
}

/**
 * 2D renklendirmeyi kaldır — orijinal görünüme dön.
 * Crossfade ile yumuşak geçiş yapar.
 * @returns {boolean} başarı
 */
export function restore2DOriginal() {
  // Önceki crossfade'i iptal et
  if (_crossfadeRAF) {
    cancelAnimationFrame(_crossfadeRAF);
    _crossfadeRAF = null;
  }

  const overlay = getOverlayCanvas(false);
  if (!overlay || overlay.style.display === "none") {
    _activePalette = "none";
    return true;
  }

  // Mevcut overlay'ı al (çıkış animasyonu için)
  const w = overlay.width;
  const h = overlay.height;
  if (w < 4 || h < 4) {
    overlay.style.display = "none";
    _activePalette = "none";
    return true;
  }

  // Snapshot al
  const snapshot = document.createElement("canvas");
  snapshot.width = w;
  snapshot.height = h;
  snapshot.getContext("2d").drawImage(overlay, 0, 0);
  snapshot.style.cssText = OVERLAY_STYLE + "z-index:6;opacity:1;display:'';";

  // Eski overlay'ı temizle (alt katman olarak)
  overlay.style.display = "none";

  // Wrap'a ekle (animasyon sırasında)
  const wrap = document.getElementById("preview-wrap");
  if (wrap) wrap.appendChild(snapshot);

  // Fade-out animasyonu
  const startTime = performance.now();
  const duration = 200;

  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const ease = t * t; // ease-in — başta yavaş, sonda hızlı
    snapshot.style.opacity = String(1 - ease);

    if (t < 1) {
      _crossfadeRAF = requestAnimationFrame(tick);
    } else {
      // Temizle
      snapshot.remove();
      _crossfadeRAF = null;
    }
  }

  _crossfadeRAF = requestAnimationFrame(tick);
  _activePalette = "none";
  return true;
}

/**
 * Mevcut 2D renklendirmeyi devre dışı bırak.
 */
export function clearColorizer2D() {
  apply2DColorizer("none");
}

/* ── Public API ────────────────────────────────────── */

/**
 * Renk şeması uygula — undo/redo ile.
 * 2D preview'a renklendirme uygular, 3D ground mesh'i de günceller.
 *
 * @param {string} paletteKey
 * @param {Object} [options]
 * @param {boolean} [options.pushUndo=true] — undo yığınına ekle
 * @param {boolean} [options.update3D=true] — 3D ground mesh'i de güncelle
 */
export function applyMapColorizer(paletteKey, options = {}) {
  const { pushUndo = true, update3D = true } = options;
  const oldKey = _activePalette;

  if (paletteKey === oldKey) return;

  // Undo kaydet — sadece kullanıcı müdahalesinde
  // (3D senkronizasyonundan gelmiyorsa)
  if (pushUndo && !_syncingFrom3D) {
    pushState("map-color-change", { prev: oldKey, next: paletteKey });
  }

  // 2D preview'a uygula
  apply2DColorizer(paletteKey);

  // 3D ground mesh'i de güncelle (mevcut colorizer.js entegrasyonu)
  if (update3D && typeof window.__applyColorizer3D === "function") {
    window.__applyColorizer3D(paletteKey);
    // 3D colorizer select'ini de güncelle (programatik çağrıda otomatik güncellenmez)
    const sel3d = document.getElementById("colorizer-palette");
    if (sel3d) sel3d.value = paletteKey;
  }
}

/**
 * Geri al (undo handler'dan çağrılır).
 * @param {string} paletteKey — geri dönülecek şema
 */
export function undoMapColorizer(paletteKey) {
  _syncingFrom3D = true;
  apply2DColorizer(paletteKey);
  if (typeof window.__applyColorizer3D === "function") {
    window.__applyColorizer3D(paletteKey);
    const sel3d = document.getElementById("colorizer-palette");
    if (sel3d) sel3d.value = paletteKey;
  }
  _syncingFrom3D = false;
}

/**
 * İleri al (redo handler'dan çağrılır).
 * @param {string} paletteKey — ileri gidilecek şema
 */
export function redoMapColorizer(paletteKey) {
  _syncingFrom3D = true;
  apply2DColorizer(paletteKey);
  if (typeof window.__applyColorizer3D === "function") {
    window.__applyColorizer3D(paletteKey);
    const sel3d = document.getElementById("colorizer-palette");
    if (sel3d) sel3d.value = paletteKey;
  }
  _syncingFrom3D = false;
}

/** 3D senkronizasyon bayrağı — undo Engellemek için */
let _syncingFrom3D = false;

/**
 * 3D senkronizasyon modunu aç/kapa.
 * Bu sürede undo entry oluşturulmaz.
 * @param {boolean} v
 */
export function setSyncingFrom3D(v) {
  _syncingFrom3D = !!v;
}

/**
 * Şu anki aktif 2D renk şemasını döndür.
 * @returns {string}
 */
export function getActiveMapPalette() {
  return _activePalette;
}

/**
 * 2D renklendirme aktif mi?
 * @returns {boolean}
 */
export function isMapColorized() {
  return _activePalette !== "none";
}

/**
 * Yeni harita yüklendiğinde durumu sıfırla.
 */
export function resetMapColorizer() {
  _rawImageBase64 = null;
  _activePalette = "none";
  restore2DOriginal();
}

/* ── UI Binding ────────────────────────────────────── */

/** Thumbnail boyutları */
const SWATCH_W = 32;
const SWATCH_H = 14;
const SWATCH_SELECTED_BORDER = "#3edc8c";
const SWATCH_DEFAULT_BORDER = "rgba(255,255,255,0.08)";
const SWATCH_HOVER_BORDER = "rgba(255,255,255,0.25)";

/** Aktif swatch elementleri (seçimi vurgulamak için) */
let _swatchEls = {};

/**
 * Tek bir palet için mini gradient canvas oluştur.
 * @param {string} paletteKey
 * @param {boolean} selected — seçili mi
 * @returns {HTMLCanvasElement}
 */
function createSwatchCanvas(paletteKey, selected) {
  const canvas = document.createElement("canvas");
  canvas.width = SWATCH_W;
  canvas.height = SWATCH_H;
  canvas.style.cssText = `width:${SWATCH_W}px;height:${SWATCH_H}px;border-radius:2px;cursor:pointer;border:1.5px solid ${selected ? SWATCH_SELECTED_BORDER : SWATCH_DEFAULT_BORDER};transition:border-color 0.15s,box-shadow 0.15s;${selected ? "box-shadow:0 0 4px rgba(62,220,140,0.4);" : ""}`;
  canvas.title = PALETTES[paletteKey]?.label || paletteKey;
  canvas.dataset.palette = paletteKey;

  const ctx = canvas.getContext("2d");
  const pal = PALETTES[paletteKey];

  if (!pal || !pal.stops) {
    // "Kapalı" — checkerboard pattern
    const size = 4;
    for (let y = 0; y < SWATCH_H; y += size) {
      for (let x = 0; x < SWATCH_W; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? "#1a1e28" : "#2a2e38";
        ctx.fillRect(x, y, size, size);
      }
    }
    // "X" işareti
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 3); ctx.lineTo(SWATCH_W - 4, SWATCH_H - 3);
    ctx.moveTo(SWATCH_W - 4, 3); ctx.lineTo(4, SWATCH_H - 3);
    ctx.stroke();
    return canvas;
  }

  // Gradient canvas'a çiz
  for (let x = 0; x < SWATCH_W; x++) {
    const t = x / (SWATCH_W - 1);
    // En yakın iki stop bul
    let j = 0;
    while (j < pal.stops.length - 2 && pal.stops[j + 1].t < t) j++;
    const s0 = pal.stops[j];
    const s1 = pal.stops[j + 1];
    const range = s1.t - s0.t || 1;
    const f = Math.max(0, Math.min(1, (t - s0.t) / range));
    const r = Math.round(s0.r + (s1.r - s0.r) * f);
    const g = Math.round(s0.g + (s1.g - s0.g) * f);
    const b = Math.round(s0.b + (s1.b - s0.b) * f);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 1, SWATCH_H);
  }

  return canvas;
}

/**
 * Seçili swatch'ın kenarlığını güncelle.
 * @param {string} paletteKey
 */
function updateSwatchSelection(paletteKey) {
  for (const [key, el] of Object.entries(_swatchEls)) {
    const isSelected = key === paletteKey;
    el.style.borderColor = isSelected ? SWATCH_SELECTED_BORDER : SWATCH_DEFAULT_BORDER;
    el.style.boxShadow = isSelected ? "0 0 4px rgba(62,220,140,0.4)" : "";
  }
}

/**
 * HTML'deki swatch konteynerini bu modüle bağlar.
 * Her palet için mini gradient canvas oluşturur.
 */
export function bind2DColorizer() {
  const container = document.getElementById("map-colorizer-swatches");
  if (!container) return;

  container.innerHTML = "";
  _swatchEls = {};

  for (const [key, pal] of Object.entries(PALETTES)) {
    const swatch = createSwatchCanvas(key, key === _activePalette);
    _swatchEls[key] = swatch;

    swatch.addEventListener("click", () => {
      applyMapColorizer(key);
      updateSwatchSelection(key);
    });

    swatch.addEventListener("mouseenter", () => {
      if (key !== _activePalette) {
        swatch.style.borderColor = SWATCH_HOVER_BORDER;
      }
    });

    swatch.addEventListener("mouseleave", () => {
      if (key !== _activePalette) {
        swatch.style.borderColor = SWATCH_DEFAULT_BORDER;
      }
    });

    container.appendChild(swatch);
  }
}

/**
 * Swatch seçim UI'ını güncelle (dışarıdan çağrılabilir).
 * @param {string} paletteKey
 */
export function updateSwatchUI(paletteKey) {
  updateSwatchSelection(paletteKey);
}

/** Opacity slider'ı bağla (main.js'den çağrılır). */
export { bindOpacitySlider };

/**
 * Döngüsel geçiş butonunu bağla (2D için).
 * Artık gerekli değil — swatch'lar doğrudan seçim yapıyor.
 */
export function bind2DColorizerCycle() {
  // Swatch tabanlı UI'da döngü butonu kaldırıldı.
}

/* ── Opacity (Karıştırma) ────────────────────────────── */

/** Kullanıcı opacity değeri (0–1) */
let _overlayOpacity = 1;

/**
 * Overlay canvas opacity'ını ayarla.
 * Slider'dan çağrılır.
 * @param {number} pct — 0..100
 */
export function setOverlayOpacity(pct) {
  _overlayOpacity = Math.max(0, Math.min(1, pct / 100));
  const overlay = getOverlayCanvas(false);
  if (overlay && overlay.style.display !== "none") {
    // Crossfade animasyonu sırasında opacity很难 uygulanır;
    // animasyon bittikten sonra kalıcı opacity olarak ayarlanır.
    // Yine de mevcut opacity'ı max ile sınırla.
    if (!_crossfadeRAF) {
      overlay.style.opacity = String(_overlayOpacity);
    }
  }
  // Label güncelle
  const label = document.getElementById("map-colorizer-opacity-label");
  if (label) label.textContent = Math.round(pct) + "%";
}

/** Mevcut overlay opacity değerini döndür (0–1). */
export function getOverlayOpacity() {
  return _overlayOpacity;
}

/** Slider'ı bağla. */
function bindOpacitySlider() {
  const slider = document.getElementById("map-colorizer-opacity");
  if (!slider) return;
  slider.addEventListener("input", () => {
    setOverlayOpacity(Number(slider.value) || 100);
  });
}

/**
 * Crossfade bittiğinde çağrılır — kullanıcının opacity ayarını uygula.
 */
function applyUserOpacity() {
  const overlay = getOverlayCanvas(false);
  if (overlay && overlay.style.display !== "none" && _overlayOpacity < 1) {
    overlay.style.opacity = String(_overlayOpacity);
  }
}

/* ── Dışa Aktarma (Export) ──────────────────────────── */

/**
 * Mevcut 2D renklendirilmiş haritayı PNG olarak indir.
 * Ham görsel + renklendirme overlay'ını birleştirir.
 */
export function exportColoredMap() {
  const imgEl = document.getElementById("preview");
  if (!imgEl || !imgEl.naturalWidth) return;

  const w = imgEl.naturalWidth;
  const h = imgEl.naturalHeight;
  if (w < 4 || h < 4) return;

  // Composite canvas: ham görsel + renk overlay
  const composite = document.createElement("canvas");
  composite.width = w;
  composite.height = h;
  const ctx = composite.getContext("2d");

  // 1) Ham görseli çiz
  ctx.drawImage(imgEl, 0, 0, w, h);

  // 2) Renk overlay varsa üstüne çiz
  const overlay = getOverlayCanvas(false);
  if (overlay && overlay.style.display !== "none" && overlay.width > 0) {
    ctx.globalAlpha = parseFloat(overlay.style.opacity) || 1;
    ctx.drawImage(overlay, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // 3) Dosya adı: palet adı + orijinal dosya adı
  const palLabel = PALETTES[_activePalette]?.label || "harita";
  const origName = state.pendingFile?.name || "map";
  const baseName = origName.replace(/\.[^.]+$/, "");
  const fileName = _activePalette && _activePalette !== "none"
    ? `${baseName}_${palLabel.toLowerCase().replace(/\s+/g, "-")}.png`
    : `${baseName}.png`;

  // 4) İndir
  composite.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/** Export butonunu bağla (main.js bind2DColorizer ile birlikte çağrılır). */
export function bindExportButton() {
  document.getElementById("btn-map-color-export")?.addEventListener("click", exportColoredMap);
}
